/**
 * Local Source — official MangaYomu extension.
 *
 * Reads manga libraries from the server filesystem and exposes them as a
 * normal source (browse, search, detail, chapters, pages, progress). The
 * browser client never touches the filesystem: everything is served through
 * the MangaYomu server runtime.
 *
 * User model
 * ----------
 * Every authenticated MangaYomu user has their own configuration: roots
 * (library or manga mode) and manga metadata mappings. Root paths point at
 * the server filesystem and must be readable by the server process; this is
 * an extension-owned decision, not a core capability.
 *
 * Runtime contract (injected `runtime` object)
 * --------------------------------------------
 *   runtime.fetch                        – global fetch (unused by this source)
 *   runtime.parseHtml                    – linkedom document parser (unused)
 *   runtime.storage                      – host-persisted per-extension,
 *       per-user key/value store:
 *       storage.get(extensionId, userId, key)   ->  Promise<string|null>
 *       storage.set(extensionId, userId, key, value) -> Promise<true>
 *       storage.remove(extensionId, userId, key) -> Promise<true>
 *     Values are opaque strings; this source serializes its config document
 *     as JSON. Used first so roots/mappings survive server restarts.
 *   runtime.extStore                     – optional document store fallback
 *       (test harnesses and pre-integration loads):
 *       extStore.get(userId, docId)      ->  Promise<object | null>
 *       extStore.put(userId, docId, data)->  Promise<void>
 *       extStore.delete(userId, docId)   ->  Promise<void>
 *     When neither store is present, the extension keeps per-user
 *     configuration in memory for the lifetime of the loaded package
 *     (documented, test-friendly).
 *
 * Request options carry the user: the host passes `userId` inside
 * `requestOptions` for list/search/detail/chapters/pages.
 *
 * Identifiers
 * -----------
 * Manga and chapter ids are opaque, stable tokens that never contain the raw
 * filesystem path:
 *   manga id   = "local." + base64url({r: rootId, p: relPath})
 *   chapter id = "local." + base64url({r: rootId, p: relPath, c: chapterName})
 * Metadata mappings change titles/covers without changing ids, so favorites
 * and reading progress survive metadata edits.
 *
 * Image URLs
 * ----------
 * Page and cover URLs use the extension scheme
 *   mangayomu-image://image?chapter=…&file=…
 * The client contribution rewrites these tokens into the authenticated
 * extension request endpoint; the extensionRequest "image" handler resolves
 * the token strictly inside the owning chapter directory.
 */

import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { inflateRawSync } from "node:zlib";

export const SOURCE_ID = "local";
export const PACKAGE_ID = "local-source";
export const IMAGE_SCHEME = "mangayomu-image://";
export const MAX_CBZ_ENTRIES = 2048;
export const MAX_CBZ_BYTES = 384 * 1024 * 1024;
const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);
const CONFIG_DOC = "local-source-config";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function base64url(text) {
  return Buffer.from(text, "utf-8").toString("base64url");
}

function debase64url(text) {
  try {
    return Buffer.from(text, "base64url").toString("utf-8");
  } catch {
    return null;
  }
}

export function encodeMangaId(rootId, relPath) {
  return "local." + base64url(JSON.stringify({ r: rootId, p: relPath || "" }));
}

export function decodeMangaId(id) {
  if (typeof id !== "string" || !id.startsWith("local.")) return null;
  const json = debase64url(id.slice("local.".length));
  if (!json) return null;
  try {
    const parsed = JSON.parse(json);
    if (parsed && typeof parsed.r === "string" && typeof parsed.p === "string") return parsed;
  } catch {
    return null;
  }
  return null;
}

export function encodeChapterId(rootId, relPath, chapterName) {
  return "local." + base64url(JSON.stringify({ r: rootId, p: relPath || "", c: chapterName }));
}

export function decodeChapterId(id) {
  if (typeof id !== "string" || !id.startsWith("local.")) return null;
  const json = debase64url(id.slice("local.".length));
  if (!json) return null;
  try {
    const parsed = JSON.parse(json);
    if (parsed && typeof parsed.r === "string" && typeof parsed.p === "string" && typeof parsed.c === "string") {
      return parsed;
    }
  } catch {
    return null;
  }
  return null;
}

function naturalCompare(a, b) {
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
  return collator.compare(a, b);
}

function isImageFile(name) {
  return IMAGE_EXTENSIONS.has(path.extname(name).toLowerCase());
}

function titleFromFolder(folderName) {
  return folderName
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

/** Resolve a relative path against a root, refusing traversal/absolute paths. */
function safeJoin(rootPath, relPath) {
  if (relPath === null || relPath === undefined) return null;
  if (typeof relPath !== "string") return null;
  if (relPath.includes("\0")) return null;
  if (relPath === "") return rootPath;
  if (path.isAbsolute(relPath)) return null;
  const parts = relPath.split(/[/\\]+/);
  if (parts.some((part) => part === ".." || part === "." || part === "")) return null;
  const resolved = path.resolve(rootPath, ...parts);
  if (resolved !== rootPath && !resolved.startsWith(rootPath + path.sep)) return null;
  return resolved;
}

/** Validate a single file name (no separators, no traversal). */
function safeFileName(name) {
  if (typeof name !== "string" || !name) return null;
  if (name.includes("/") || name.includes("\\") || name.includes("\0") || name === "." || name === "..") return null;
  return name;
}

// ---------------------------------------------------------------------------
// Minimal ZIP/CBZ reader (self-contained, stored + deflate only)
// ---------------------------------------------------------------------------

function findEocd(buffer) {
  const start = Math.max(0, buffer.length - 65557);
  for (let i = buffer.length - 22; i >= start; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) return i;
  }
  return -1;
}

export function listZipImageEntries(buffer) {
  const eocd = findEocd(buffer);
  if (eocd < 0) throw new Error("Invalid CBZ: end of central directory not found");
  const count = buffer.readUInt16LE(eocd + 10);
  const cdOffset = buffer.readUInt32LE(eocd + 16);
  if (count > MAX_CBZ_ENTRIES) throw new Error("CBZ has too many entries");
  let offset = cdOffset;
  const entries = [];
  for (let i = 0; i < count; i++) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error("Invalid CBZ central directory");
    }
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString("utf-8", offset + 46, offset + 46 + nameLength);
    offset += 46 + nameLength + extraLength + commentLength;

    if (name.includes("\\") || name.split("/").includes("..") || name.startsWith("/")) {
      throw new Error("Unsafe path in CBZ: " + name);
    }
    if (name.endsWith("/")) continue; // directory entry
    if (!isImageFile(path.basename(name))) continue;

    if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== 0x04034b50) {
      throw new Error("Invalid CBZ local header for " + name);
    }
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    if (dataStart + compressedSize > buffer.length) throw new Error("CBZ data truncated for " + name);
    entries.push({
      name: path.basename(name),
      method,
      compressedSize,
      uncompressedSize,
      dataStart,
    });
  }
  return entries.sort((a, b) => naturalCompare(a.name, b.name));
}

export function extractZipEntry(buffer, entry) {
  const chunk = buffer.subarray(entry.dataStart, entry.dataStart + entry.compressedSize);
  if (entry.method === 0) return chunk;
  if (entry.method === 8) return inflateRawSync(chunk);
  throw new Error("Unsupported CBZ compression method " + entry.method);
}

// ---------------------------------------------------------------------------
// Local Source
// ---------------------------------------------------------------------------

export function createLocalSource(runtime = {}) {
  const hostStorage =
    runtime.storage && typeof runtime.storage.get === "function" &&
    typeof runtime.storage.set === "function" && typeof runtime.storage.remove === "function"
      ? runtime.storage
      : null;
  const extStore =
    !hostStorage && runtime.extStore && typeof runtime.extStore.get === "function" ? runtime.extStore : null;
  // Memory fallback: per-user config + rescan caches, isolated per instance.
  const memory = new Map();
  const scanCache = new Map(); // userId -> { at, data }

  // Host storage persists opaque strings per (extension, user, key); the
  // config document is stored as JSON and parsed on read.
  const scopedStore = {
    async get(userId, docId) {
      if (hostStorage) {
        const stored = await hostStorage.get(PACKAGE_ID, String(userId), docId);
        if (stored === null || stored === undefined || stored === "") return null;
        if (typeof stored === "string") {
          try {
            return JSON.parse(stored);
          } catch (_) {
            return stored;
          }
        }
        return stored;
      }
      if (extStore) return extStore.get(userId, docId);
      const box = memory.get(userId);
      return box && Object.prototype.hasOwnProperty.call(box, docId) ? box[docId] : null;
    },
    async put(userId, docId, data) {
      if (hostStorage) {
        await hostStorage.set(PACKAGE_ID, String(userId), docId, JSON.stringify(data));
        return;
      }
      if (extStore) return extStore.put(userId, docId, data);
      if (!memory.has(userId)) memory.set(userId, {});
      memory.get(userId)[docId] = data;
    },
    async delete(userId, docId) {
      if (hostStorage) {
        await hostStorage.remove(PACKAGE_ID, String(userId), docId);
        return;
      }
      if (extStore) return extStore.delete(userId, docId);
      const box = memory.get(userId);
      if (box) delete box[docId];
    },
  };

  async function loadConfig(userId) {
    const stored = await scopedStore.get(userId, CONFIG_DOC);
    const config = stored && typeof stored === "object" ? stored : {};
    if (!Array.isArray(config.roots)) config.roots = [];
    if (!config.mappings || typeof config.mappings !== "object") config.mappings = {};
    return config;
  }

  async function saveConfig(userId, config) {
    await scopedStore.put(userId, CONFIG_DOC, config);
    scanCache.delete(userId);
  }

  function enabledRoots(config) {
    return config.roots.filter((root) => root && root.enabled !== false && root.path && root.mode);
  }

  function rootById(config, rootId) {
    for (const root of config.roots) {
      if (root.id === rootId) return root;
    }
    return null;
  }

  function mappingFor(config, rootId, relPath) {
    const key = rootId + ":" + relPath;
    return config.mappings[key] || null;
  }

  async function chapterFileNames(rootPath, chapterDir) {
    const stats = await fsp.stat(chapterDir).catch(() => null);
    if (!stats || !stats.isDirectory()) return null;
    const dirEntries = await fsp.readdir(chapterDir);
    return dirEntries.filter((name) => isImageFile(name)).sort(naturalCompare);
  }

  async function chapterPagesFromCbz(rootPath, chapterPath) {
    const stats = await fsp.stat(chapterPath).catch(() => null);
    if (!stats || !stats.isFile()) return null;
    if (stats.size > MAX_CBZ_BYTES) throw new Error("CBZ is too large: " + chapterPath);
    const buffer = await fsp.readFile(chapterPath);
    const entries = listZipImageEntries(buffer);
    // Do not keep the raw archive in memory after the scan; the image handler
    // re-reads it through a small LRU byte cache.
    return {
      filePath: chapterPath,
      size: stats.size,
      entries,
      fileNames: entries.map((entry) => entry.name),
    };
  }

  // Bounded LRU of parsed CBZ bytes keyed by chapter id (max 6 archives).
  const archiveBuffers = new Map();
  const ARCHIVE_BUFFER_MAX = 6;
  async function archiveBuffer(chapterId, filePath) {
    if (archiveBuffers.has(chapterId)) {
      const value = archiveBuffers.get(chapterId);
      archiveBuffers.delete(chapterId);
      archiveBuffers.set(chapterId, value);
      return value;
    }
    const stats = await fsp.stat(filePath).catch(() => null);
    if (!stats || !stats.isFile() || stats.size > MAX_CBZ_BYTES) return null;
    const buffer = await fsp.readFile(filePath);
    archiveBuffers.set(chapterId, buffer);
    while (archiveBuffers.size > ARCHIVE_BUFFER_MAX) {
      archiveBuffers.delete(archiveBuffers.keys().next().value);
    }
    return buffer;
  }

  /**
   * Enumerate a manga's chapters. A chapter is an image directory or a
   * .cbz/.zip archive inside the manga's directory. Returns entries with
   * stable chapter ids and page counts.
   */
  async function scanMangaChapters(root, mangaDir) {
    const relPath = path.relative(root.path, mangaDir);
    const dirEntries = await fsp.readdir(mangaDir, { withFileTypes: true });
    const chapters = [];
    for (const entry of dirEntries) {
      const full = path.join(mangaDir, entry.name);
      if (entry.isDirectory()) {
        const images = await chapterFileNames(root.path, full);
        if (!images) continue;
        if (images.length === 0) continue;
        chapters.push({ name: entry.name, pages: images, archive: null });
      } else if (entry.isFile() && /\.(cbz|zip)$/i.test(entry.name)) {
        const info = await chapterPagesFromCbz(root.path, full);
        if (!info) continue;
        if (info.entries.length === 0) continue;
        chapters.push({ name: entry.name.replace(/\.(cbz|zip)$/i, ""), archive: info });
      }
    }
    chapters.sort((a, b) => naturalCompare(a.name, b.name));
    return chapters.map((chapter) => ({
      id: encodeChapterId(root.id, relPath, chapter.name),
      chapterNumber: parseChapterNumber(chapter.name),
      pageCount: chapter.archive ? chapter.archive.entries.length : chapter.pages.length,
      name: chapter.name,
      mangaDir,
      isArchive: !!chapter.archive,
      archive: chapter.archive || null,
      pages: chapter.pages || [],
    }));
  }

  function parseChapterNumber(name) {
    const match = String(name).match(/(\d+(?:\.\d+)?)/);
    return match ? parseFloat(match[1]) : null;
  }

  /** Rebuild the in-memory per-user index (roots + manga + chapters). */
  async function rescan(userId) {
    const config = await loadConfig(userId);
    const roots = enabledRoots(config);
    const manga = [];
    for (const root of roots) {
      const rootPath = path.resolve(root.path);
      const stats = await fsp.stat(rootPath).catch(() => null);
      if (!stats || !stats.isDirectory()) continue;
      if (root.mode === "manga") {
        const chapters = await scanMangaChapters(root, rootPath);
        manga.push({ root, relPath: "", chapters, dir: rootPath });
      } else {
        const entries = await fsp.readdir(rootPath, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          if (entry.name.startsWith(".")) continue;
          const mangaDir = path.join(rootPath, entry.name);
          const chapters = await scanMangaChapters(root, mangaDir);
          manga.push({ root, relPath: entry.name, chapters, dir: mangaDir });
        }
      }
    }
    const data = {
      at: Date.now(),
      manga: manga.map((item, index) => ({
        index,
        rootId: item.root.id,
        relPath: item.relPath,
        dir: item.dir,
        chapters: item.chapters.map((chapter) => ({
          id: chapter.id,
          chapterNumber: chapter.chapterNumber,
          volume: null,
          title: "",
          lang: "en",
          pageCount: chapter.pageCount,
          createdAt: null,
        })),
      })),
    };
    // Keep resolved chapter handles separate (path + archive cache).
    const chapterCache = new Map();
    for (const item of manga) {
      for (const chapter of item.chapters) chapterCache.set(chapter.id, chapter);
    }
    scanCache.set(userId, { at: data.at, data, chapterCache, config });
    return { roots: roots.length, manga: data.manga.length };
  }

  async function ensureIndex(userId) {
    const cached = scanCache.get(userId);
    if (cached && Date.now() - cached.at < 30_000) return cached;
    await rescan(userId);
    const fresh = scanCache.get(userId);
    if (!fresh) throw new Error("Local source scan failed");
    return fresh;
  }

  function mangaRecord(index, rootId, relPath) {
    const key = rootId + ":" + relPath;
    for (const item of index.data.manga) {
      if (item.rootId === rootId && item.relPath === relPath) {
        const config = index.config;
        const mapping = config ? mappingFor(config, rootId, relPath) : null;
        const root = config ? rootById(config, rootId) : null;
        const fallbackTitle = relPath ? titleFromFolder(relPath) : root ? root.label || root.path : "Local manga";
        return { item, mapping, fallbackTitle, key };
      }
    }
    return null;
  }

  // -- Public source interface ----------------------------------------------

  return {
    id: SOURCE_ID,
    name: "Local Source",
    lang: "en",
    defaultLanguage: "en",
    languages: [{ code: "en", label: "English", flag: "🇬🇧" }],
    baseUrl: "",

    getImageHeaders() {
      return {};
    },

    async getLatestManga(page = 1, requestOptions = {}) {
      const userId = String(requestOptions.userId || "default");
      const index = await ensureIndex(userId);
      const config = await loadConfig(userId);
      const perPage = 100;
      const start = (page - 1) * perPage;
      const slice = index.data.manga.slice(start, start + perPage);
      return slice.map((item) => {
        const mapping = mappingFor(config, item.rootId, item.relPath);
        const root = rootById(config, item.rootId);
        const title = mapping && mapping.title ? mapping.title : item.relPath ? titleFromFolder(item.relPath) : root ? root.label || root.path : "Local manga";
        return {
          id: encodeMangaId(item.rootId, item.relPath),
          title,
          coverUrl: coverToken(encodeMangaId(item.rootId, item.relPath), mapping && mapping.cover),
          source: SOURCE_ID,
        };
      });
    },

    async searchManga(query, page = 1, requestOptions = {}) {
      const userId = String(requestOptions.userId || "default");
      const index = await ensureIndex(userId);
      const config = await loadConfig(userId);
      const needle = String(query || "").toLowerCase().trim();
      const results = [];
      for (const item of index.data.manga) {
        const mapping = mappingFor(config, item.rootId, item.relPath);
        const root = rootById(config, item.rootId);
        const names = [
          mapping && mapping.title,
          mapping && mapping.altTitle,
          item.relPath ? titleFromFolder(item.relPath) : root ? root.label || root.path : "",
          item.relPath,
        ].filter(Boolean).map((value) => String(value).toLowerCase());
        if (!needle || names.some((name) => name.includes(needle))) {
          results.push({
            id: encodeMangaId(item.rootId, item.relPath),
            title: mapping && mapping.title ? mapping.title : item.relPath ? titleFromFolder(item.relPath) : root ? root.label || root.path : "Local manga",
            coverUrl: coverToken(encodeMangaId(item.rootId, item.relPath), mapping && mapping.cover),
            source: SOURCE_ID,
          });
        }
      }
      const perPage = 100;
      return results.slice((page - 1) * perPage, page * perPage);
    },

    async getMangaDetail(id, requestOptions = {}) {
      const userId = String(requestOptions.userId || "default");
      const decoded = decodeMangaId(id);
      if (!decoded) throw detailError("Unknown local manga");
      const index = await ensureIndex(userId);
      const record = mangaRecord(index, decoded.r, decoded.p);
      if (!record) throw detailError("Local manga not found");
      const { item, mapping } = record;
      const root = rootById(index.config, item.rootId);
      const chapters = index.data.manga[item.index].chapters.map((chapter) => ({
        id: chapter.id,
        chapterNumber: chapter.chapterNumber,
        volume: null,
        title: "",
        lang: "en",
        pageCount: chapter.pageCount,
        createdAt: null,
      }));
      const fallbackTitle = item.relPath ? titleFromFolder(item.relPath) : root ? root.label || root.path : "Local manga";
      return {
        id,
        title: mapping && mapping.title ? mapping.title : fallbackTitle,
        altTitle: mapping && mapping.altTitle ? mapping.altTitle : null,
        description: mapping && mapping.description ? mapping.description : null,
        coverUrl: coverToken(id, mapping && mapping.cover),
        authors: mapping && mapping.author ? [mapping.author] : [],
        genres: mapping && Array.isArray(mapping.genres) ? mapping.genres : [],
        status: mapping && mapping.status ? mapping.status : "unknown",
        source: SOURCE_ID,
        availableLanguages: [{ code: "en", label: "English", flag: "🇬🇧" }],
        displayLanguage: "en",
        chapters,
      };
    },

    async getChapters(mangaId, requestOptions = {}) {
      const userId = String(requestOptions.userId || "default");
      const decoded = decodeMangaId(mangaId);
      if (!decoded) return [];
      const index = await ensureIndex(userId);
      const record = mangaRecord(index, decoded.r, decoded.p);
      if (!record) return [];
      return index.data.manga[record.item.index].chapters;
    },

    async getChapterPages(chapterId, mangaId = null, requestOptions = {}) {
      const userId = String((requestOptions && requestOptions.userId) || "default");
      const decoded = decodeChapterId(chapterId);
      if (!decoded) throw pagesError("Unknown local chapter");
      const index = await ensureIndex(userId);
      // Chapter handles come only from the requesting user's own scan cache;
      // a token from another user's roots never resolves here.
      const root = rootById(index.config, decoded.r);
      if (!root) throw pagesError("Local chapter not found");
      const handle = index.chapterCache.get(chapterId);
      if (!handle) throw pagesError("Local chapter not found (rescan the library)");
      if (handle.isArchive && handle.archive) {
        return {
          urls: handle.archive.fileNames.map((fileName) => imageToken(chapterId, fileName)),
        };
      }
      if (handle.pages && handle.pages.length > 0) {
        return {
          urls: handle.pages.map((fileName) => imageToken(chapterId, fileName)),
        };
      }
      throw pagesError("Local chapter has no pages");
    },

    /**
     * Extension request handler (host contract):
     *   extensionRequest({ method, path, body, query, userId })
     * Returns { status, contentType, body } where body is an object (JSON) or
     * a Buffer (image bytes).
     */
    async extensionRequest({ method, path: reqPath = "", body = null, query = null, userId = "default" } = {}) {
      const uid = String(userId);
      const route = String(reqPath || "").replace(/^\/+/, "").split("?")[0];
      const q = query && typeof query === "object" ? query : {};

      if (route === "config" && method === "GET") {
        const config = await loadConfig(uid);
        return json(200, config);
      }

      if (route === "config" && method === "PUT") {
        const next = body && typeof body === "object" ? body : {};
        const current = await loadConfig(uid);
        const roots = [];
        for (const root of Array.isArray(next.roots) ? next.roots : []) {
          if (!root || typeof root.path !== "string" || !root.path.trim()) continue;
          if (typeof root.mode !== "string" || (root.mode !== "library" && root.mode !== "manga")) continue;
          if (String(root.path).includes("\0")) continue;
          roots.push({
            id: typeof root.id === "string" && root.id ? root.id : randomUUID(),
            path: root.path.trim(),
            mode: root.mode,
            label: typeof root.label === "string" ? root.label.trim() : "",
            enabled: root.enabled !== false,
          });
        }
        // Root edits never wipe metadata mappings: when the caller does not
        // send a mappings object we keep the previously stored one.
        const hasMappings = next.mappings && typeof next.mappings === "object" && !Array.isArray(next.mappings);
        const mappings = hasMappings ? next.mappings : current.mappings || {};
        await saveConfig(uid, { roots, mappings });
        return json(200, { ok: true, roots });
      }

      if (route === "rescan" && method === "POST") {
        const summary = await rescan(uid);
        return json(200, { ok: true, ...summary });
      }

      if (route === "mappings" && method === "GET") {
        const config = await loadConfig(uid);
        return json(200, { mappings: config.mappings || {} });
      }

      if (route === "mappings" && method === "PUT") {
        const config = await loadConfig(uid);
        const entry = body && typeof body === "object" ? body : {};
        if (typeof entry.key !== "string" || !entry.key) return json(400, { error: "Missing mapping key" });
        config.mappings[entry.key] = {
          title: typeof entry.title === "string" ? entry.title : "",
          altTitle: typeof entry.altTitle === "string" ? entry.altTitle : "",
          author: typeof entry.author === "string" ? entry.author : "",
          description: typeof entry.description === "string" ? entry.description : "",
          status: typeof entry.status === "string" ? entry.status : "",
          genres: Array.isArray(entry.genres) ? entry.genres.filter((g) => typeof g === "string") : [],
          cover: typeof entry.cover === "string" ? entry.cover : "",
        };
        await saveConfig(uid, config);
        return json(200, { ok: true });
      }

      if (method === "DELETE" && route.startsWith("mappings/")) {
        const key = decodeURIComponent(route.slice("mappings/".length));
        const config = await loadConfig(uid);
        delete config.mappings[key];
        await saveConfig(uid, config);
        return json(200, { ok: true });
      }

      if (route === "image" && method === "GET") {
        return serveImage(uid, q);
      }

      if (route === "library" && method === "GET") {
        // Flat listing: every manga with its mapping key, for the admin UI.
        const index = await ensureIndex(uid);
        const config = await loadConfig(uid);
        const items = index.data.manga.map((item) => {
          const key = item.rootId + ":" + item.relPath;
          const mapping = config.mappings[key] || null;
          const root = rootById(config, item.rootId);
          return {
            rootId: item.rootId,
            rootPath: root ? root.path : "",
            relPath: item.relPath,
            key,
            id: encodeMangaId(item.rootId, item.relPath),
            title: mapping && mapping.title ? mapping.title : item.relPath ? titleFromFolder(item.relPath) : root ? root.label || root.path : "Local manga",
            chapterCount: item.chapters.length,
            mapping: mapping || null,
          };
        });
        return json(200, { manga: items });
      }

      return json(404, { error: "Unknown local source request: " + route });
    },
  };

  // -- Internal helpers (closure) -------------------------------------------

  function coverToken(mangaId, cover) {
    if (!cover) return null;
    return IMAGE_SCHEME + "image?cover=" + encodeURIComponent(mangaId) + "&file=" + encodeURIComponent(cover);
  }

  function imageToken(chapterId, fileName) {
    return IMAGE_SCHEME + "image?chapter=" + encodeURIComponent(chapterId) + "&file=" + encodeURIComponent(fileName);
  }

  async function serveImage(uid, q) {
    const fileNameRaw = String(q.file || "");
    const decoded = decodeChapterId(String(q.chapter || ""));
    if (decoded) {
      const fileName = safeFileName(fileNameRaw);
      if (!fileName) return json(400, { error: "Invalid image file" });
      const index = await ensureIndex(uid);
      // The chapter must belong to this user's own scan: tokens from another
      // user's roots resolve to a missing root here and never touch files.
      const root = rootById(index.config, decoded.r);
      if (!root) return json(404, { error: "Local chapter not found" });
      const handle = index.chapterCache.get(String(q.chapter));
      if (!handle) return json(404, { error: "Local chapter not found" });
      if (handle.isArchive && handle.archive) {
        const entry = handle.archive.entries.find((item) => item.name === fileName);
        if (!entry) return json(404, { error: "Image not found in archive" });
        const buffer = await archiveBuffer(String(q.chapter), handle.archive.filePath);
        if (!buffer) return json(404, { error: "CBZ is not readable" });
        try {
          const page = extractZipEntry(buffer, entry);
          return image(200, page);
        } catch (err) {
          return json(502, { error: "Failed to read CBZ page: " + err.message });
        }
      }
      const chapterDir = path.join(handle.mangaDir, handle.name);
      const filePath = safeJoin(chapterDir, fileName);
      if (!filePath) return json(400, { error: "Invalid image path" });
      const stats = await fsp.stat(filePath).catch(() => null);
      if (!stats || !stats.isFile()) return json(404, { error: "Image not found" });
      const buffer = await fsp.readFile(filePath);
      return image(200, buffer);
    }
    // Cover token: file is either an absolute URL or a file inside the manga dir.
    const mangaId = String(q.cover || "");
    const decodedManga = decodeMangaId(mangaId);
    if (!decodedManga) return json(400, { error: "Invalid cover token" });
    if (fileNameRaw.startsWith("http://") || fileNameRaw.startsWith("https://")) {
      // Redirect responses use the host shape { status, location } so the
      // proxy/client can follow them without a JSON body wrapper.
      return { status: 302, location: fileNameRaw };
    }
    const fileName = safeFileName(fileNameRaw);
    if (!fileName) return json(400, { error: "Invalid image file" });
    const index = await ensureIndex(uid);
    const record = mangaRecord(index, decodedManga.r, decodedManga.p);
    if (!record) return json(404, { error: "Local manga not found" });
    const filePath = safeJoin(record.item.dir, fileName);
    if (!filePath) return json(400, { error: "Invalid cover path" });
    const stats = await fsp.stat(filePath).catch(() => null);
    if (!stats || !stats.isFile()) return json(404, { error: "Cover not found" });
    const buffer = await fsp.readFile(filePath);
    return image(200, buffer);
  }
}

function detailError(message) {
  const error = new Error(message);
  error.status = 404;
  return error;
}

function pagesError(message) {
  const error = new Error(message);
  error.status = 404;
  return error;
}

function json(status, body) {
  return { status, contentType: "application/json", body };
}

function image(status, body, contentType) {
  return { status, contentType: contentType || imageContentType(body), body };
}

function imageContentType(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return "image/png";
  if (buffer.length >= 4 && buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46) return "image/webp";
  if (buffer.length >= 6 && buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38) return "image/gif";
  return "image/jpeg";
}

// Package adapter: the runtime injects fetch/parseHtml/storage capabilities.
export default function createExtension(runtime) {
  return createLocalSource(runtime || {});
}