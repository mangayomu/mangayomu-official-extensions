#!/usr/bin/env node
/**
 * Local Source server behavior: per-user roots/mappings, scan, stable ids,
 * folder + CBZ chapters, image serving with strict path containment, and
 * per-user isolation. Run: node local-source/test/server.test.mjs
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { crc32 } from "node:zlib";
import createExtension, { listZipImageEntries, extractZipEntry, encodeMangaId, decodeMangaId, decodeChapterId } from "../server/index.mjs";

function makeCbz(entries) {
  // Minimal STORED-method ZIP with correct local headers, central directory
  // and EOCD, matching what the extension's safe reader accepts.
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuffer = Buffer.from(name, "utf-8");
    const checksum = crc32(data) >>> 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(0, 8); // method: stored
    local.writeUInt16LE(0, 10); // mod time
    local.writeUInt16LE(0, 12); // mod date
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    local.writeUInt16LE(0, 28); // extra len
    locals.push(Buffer.concat([local, nameBuffer, data]));
    centrals.push({ nameBuffer, checksum, dataLength: data.length, offset });
    offset += local.length + nameBuffer.length + data.length;
  }
  const centralParts = [];
  for (const entry of centrals) {
    const head = Buffer.alloc(46);
    head.writeUInt32LE(0x02014b50, 0);
    head.writeUInt16LE(20, 4); // version made by
    head.writeUInt16LE(20, 6); // version needed
    head.writeUInt16LE(0, 8);
    head.writeUInt16LE(0, 10);
    head.writeUInt16LE(0, 12);
    head.writeUInt16LE(0, 14);
    head.writeUInt32LE(entry.checksum, 16);
    head.writeUInt32LE(entry.dataLength, 20);
    head.writeUInt32LE(entry.dataLength, 24);
    head.writeUInt16LE(entry.nameBuffer.length, 28);
    head.writeUInt16LE(0, 30);
    head.writeUInt16LE(0, 32);
    head.writeUInt16LE(0, 34);
    head.writeUInt16LE(0, 36);
    head.writeUInt32LE(0, 38);
    head.writeUInt32LE(entry.offset, 42);
    centralParts.push(Buffer.concat([head, entry.nameBuffer]));
  }
  const central = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(central.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, central, eocd]);
}

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mangayomu-local-source-"));
  const libraryRoot = path.join(tmp, "library");
  const mangaRoot = path.join(tmp, "standalone");
  const yomi = path.join(libraryRoot, "yomi-no-tsugai");
  const second = path.join(libraryRoot, "second-title");
  fs.mkdirSync(path.join(yomi, "001"), { recursive: true });
  fs.mkdirSync(path.join(yomi, "002"), { recursive: true });
  fs.mkdirSync(path.join(second), { recursive: true });
  fs.mkdirSync(path.join(mangaRoot, "01"), { recursive: true });
  fs.writeFileSync(path.join(yomi, "001", "001.jpg"), Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0x01]));
  fs.writeFileSync(path.join(yomi, "001", "002.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  fs.writeFileSync(path.join(yomi, "002", "001.jpg"), Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0x02]));
  const cbz = makeCbz([
    { name: "001.jpg", data: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0x03]) },
    { name: "002.jpg", data: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0x04]) },
  ]);
  const cbzPath = path.join(second, "01.cbz");
  fs.writeFileSync(cbzPath, cbz);
  fs.writeFileSync(path.join(mangaRoot, "01", "001.jpg"), Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0x05]));
  fs.writeFileSync(path.join(second, "ignored.txt"), "not an image");

  const extension = createExtension({}); // memory store fallback
  const alice = "user-a";
  const bob = "user-b";

  // -- Config: library root + manga root for Alice only --------------------
  let res = await extension.extensionRequest({ method: "PUT", path: "/config", userId: alice, body: {
    roots: [
      { path: libraryRoot, mode: "library", label: "My Library", enabled: true },
      { path: mangaRoot, mode: "manga", label: "Standalone", enabled: true },
    ],
  }});
  assert.equal(res.status, 200, "config save succeeds");
  assert.equal(res.body.roots.length, 2, "two roots persisted");

  res = await extension.extensionRequest({ method: "POST", path: "/rescan", userId: alice });
  assert.equal(res.status, 200, "rescan succeeds");
  assert.equal(res.body.roots, 2, "rescan reports 2 roots");
  assert.equal(res.body.manga, 3, "library root gives 2 manga + manga root gives 1 = 3");

  res = await extension.extensionRequest({ method: "GET", path: "/library", userId: alice });
  assert.equal(res.status, 200, "library listing succeeds");
  assert.equal(res.body.manga.length, 3, "library lists 3 manga");
  const yomiItem = res.body.manga.find((item) => item.relPath === "yomi-no-tsugai");
  assert.ok(yomiItem, "yomi-no-tsugai found");
  assert.equal(yomiItem.chapterCount, 2, "yomi has 2 chapter folders");
  const secondItem = res.body.manga.find((item) => item.relPath === "second-title");
  assert.equal(secondItem.chapterCount, 1, "second-title has 1 CBZ chapter");

  // -- Normal source interface ---------------------------------------------
  const latest = await extension.getLatestManga(1, { userId: alice });
  assert.equal(latest.length, 3, "getLatestManga returns all 3");
  assert.ok(latest.every((m) => m.source === "local"), "source is local");
  assert.ok(latest.every((m) => m.id.startsWith("local.")), "manga ids are opaque tokens");
  assert.ok(latest.every((m) => !m.coverUrl || m.coverUrl.startsWith("mangayomu-image://")), "cover urls use the extension scheme");

  const yomiId = yomiItem.id;
  const detail = await extension.getMangaDetail(yomiId, { userId: alice });
  assert.equal(detail.title, "Yomi No Tsugai", "folder name fallback title");
  assert.equal(detail.source, "local");
  assert.equal(detail.chapters.length, 2, "detail includes chapters");
  assert.equal(detail.chapters[0].chapterNumber, 1, "natural numeric ordering");
  assert.equal(detail.chapters[0].pageCount, 2, "folder chapter 001 has 2 pages");

  const cbzManga = await extension.getMangaDetail(secondItem.id, { userId: alice });
  assert.equal(cbzManga.chapters.length, 1, "cbz chapter listed");
  assert.equal(cbzManga.chapters[0].pageCount, 2, "cbz page count read from archive");

  const pages = await extension.getChapterPages(detail.chapters[0].id, yomiId, { userId: alice });
  assert.equal(pages.urls.length, 2, "folder chapter pages");
  assert.ok(pages.urls[0].startsWith("mangayomu-image://"), "page urls use the extension scheme");

  const cbzChapter = cbzManga.chapters[0];
  const cbzPages = await extension.getChapterPages(cbzChapter.id, secondItem.id, { userId: alice });
  assert.equal(cbzPages.urls.length, 2, "cbz chapter pages listed");

  // -- Mapping keeps stable ids / progress --------------------------------
  await extension.extensionRequest({ method: "PUT", path: "/mappings", userId: alice, body: {
    key: yomiItem.key,
    title: "Demons of the Shadow Realm",
    altTitle: "Yomi no Tsugai",
    author: "Hiromu Arakawa",
    description: "A story.",
    status: "ongoing",
    genres: ["Action", "Fantasy"],
    cover: "cover.jpg",
  }});
  const remapped = await extension.getMangaDetail(yomiId, { userId: alice });
  assert.equal(remapped.title, "Demons of the Shadow Realm", "mapping overrides title");
  assert.equal(remapped.altTitle, "Yomi no Tsugai", "mapping overrides alt title");
  assert.equal(remapped.authors[0], "Hiromu Arakawa");
  assert.deepEqual(remapped.genres, ["Action", "Fantasy"]);
  assert.equal(remapped.id, yomiId, "manga id is stable when metadata changes");
  assert.equal(remapped.chapters[0].id, detail.chapters[0].id, "chapter ids stable under mapping change");

  const search = await extension.searchManga("demons", 1, { userId: alice });
  assert.equal(search.length, 1, "search matches mapped title");
  assert.equal(search[0].title, "Demons of the Shadow Realm");

  // -- Root edits preserve mappings ---------------------------------------
  const yomiChapterId = detail.chapters[0].id;
  const initialConfig = await extension.extensionRequest({ method: "GET", path: "/config", userId: alice });
  const keptRoots = initialConfig.body.roots; // existing ids stay stable
  await extension.extensionRequest({ method: "PUT", path: "/config", userId: alice, body: { roots: keptRoots } });
  const afterRootSave = await extension.getMangaDetail(yomiId, { userId: alice });
  assert.equal(afterRootSave.title, "Demons of the Shadow Realm", "mapping survives a root save without mappings in the body");
  assert.equal(afterRootSave.chapters[0].id, yomiChapterId, "chapter ids stable after root save");

  // -- Mapping deletion by key route --------------------------------------
  await extension.extensionRequest({ method: "PUT", path: "/mappings", userId: alice, body: {
    key: secondItem.key,
    title: "Second Series",
  }});
  const mappedSecond = await extension.getMangaDetail(secondItem.id, { userId: alice });
  assert.equal(mappedSecond.title, "Second Series", "mapping applied before delete");
  const del = await extension.extensionRequest({
    method: "DELETE", path: "/mappings/" + encodeURIComponent(secondItem.key), userId: alice,
  });
  assert.equal(del.status, 200, "DELETE /mappings/<key> succeeds");
  const unmapped = await extension.getMangaDetail(secondItem.id, { userId: alice });
  assert.equal(unmapped.title, "Second Title", "mapping removed by key");

  // -- Image serving (folder) ---------------------------------------------
  const fileName = "001.jpg";
  const img = await extension.extensionRequest({
    method: "GET", path: "/image", query: { chapter: detail.chapters[0].id, file: fileName }, userId: alice,
  });
  assert.equal(img.status, 200, "folder image serves 200");
  assert.ok(img.body.equals(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0x01])), "folder image bytes match");

  // -- Image serving (CBZ) -------------------------------------------------
  const cbzImg = await extension.extensionRequest({
    method: "GET", path: "/image", query: { chapter: cbzChapter.id, file: "002.jpg" }, userId: alice,
  });
  assert.equal(cbzImg.status, 200, "cbz image serves 200");
  assert.ok(cbzImg.body.equals(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0x04])), "cbz image bytes match");

  // -- Path containment -----------------------------------------------------
  const traversal = await extension.extensionRequest({
    method: "GET", path: "/image", query: { chapter: detail.chapters[0].id, file: "../secret.txt" }, userId: alice,
  });
  assert.equal(traversal.status, 400, "traversal file name rejected");

  const abs = await extension.extensionRequest({
    method: "GET", path: "/image", query: { chapter: detail.chapters[0].id, file: "/etc/passwd" }, userId: alice,
  });
  assert.equal(abs.status, 400, "absolute file name rejected");

  const missing = await extension.extensionRequest({
    method: "GET", path: "/image", query: { chapter: detail.chapters[0].id, file: "nope.jpg" }, userId: alice,
  });
  assert.equal(missing.status, 404, "missing page is 404");

  const badToken = await extension.extensionRequest({
    method: "GET", path: "/image", query: { chapter: "not-a-token", file: "001.jpg" }, userId: alice,
  });
  assert.equal(badToken.status, 400, "malformed chapter token rejected");

  assert.equal(decodeMangaId("local." + Buffer.from('{"oops":1}').toString("base64url")), null, "malformed manga id shape rejected");
  assert.equal(decodeChapterId("../evil"), null, "traversal chapter id rejected");

  // -- Per-user isolation ---------------------------------------------------
  const bobLatest = await extension.getLatestManga(1, { userId: bob });
  assert.equal(bobLatest.length, 0, "Bob sees nothing without his own roots");

  await extension.extensionRequest({ method: "PUT", path: "/config", userId: bob, body: {
    roots: [{ path: mangaRoot, mode: "manga", label: "Bob's", enabled: true }],
  }});
  const bobList = await extension.getLatestManga(1, { userId: bob });
  assert.equal(bobList.length, 1, "Bob sees only his root");
  const aliceAfterBob = await extension.getLatestManga(1, { userId: alice });
  assert.equal(aliceAfterBob.length, 3, "Alice config untouched by Bob");

  // -- Root removal ---------------------------------------------------------
  await extension.extensionRequest({ method: "PUT", path: "/config", userId: bob, body: { roots: [] } });
  const bobAfterRemove = await extension.getLatestManga(1, { userId: bob });
  assert.equal(bobAfterRemove.length, 0, "removing roots clears the library");

  // -- Cross-user chapter/image isolation -----------------------------------
  await extension.extensionRequest({ method: "PUT", path: "/config", userId: bob, body: {
    roots: [{ path: mangaRoot, mode: "manga", label: "Bob's", enabled: true }],
  }});
  // Bob's own scanned catalog does not include Alice's yomi chapter.
  let bobPagesFailed = false;
  try {
    await extension.getChapterPages(yomiChapterId, null, { userId: bob });
  } catch (err) {
    bobPagesFailed = true;
  }
  assert.ok(bobPagesFailed, "getChapterPages rejects another user's chapter token");
  const bobImg = await extension.extensionRequest({
    method: "GET", path: "/image", query: { chapter: yomiChapterId, file: "001.jpg" }, userId: bob,
  });
  assert.equal(bobImg.status, 404, "image serving rejects another user's chapter token");
  assert.equal(await extension.getLatestManga(1, { userId: alice }).then((list) => list.length), 3, "Alice library unaffected by Bob");

  // -- Host storage contract: runtime.storage is used first, persists JSON ---
  const storageCalls = [];
  const backing = new Map();
  const fakeStorage = {
    async get(extensionId, userId, key) {
      storageCalls.push(["get", extensionId, userId, key]);
      return backing.get(`${extensionId}:${userId}:${key}`) ?? null;
    },
    async set(extensionId, userId, key, value) {
      storageCalls.push(["set", extensionId, userId, key]);
      backing.set(`${extensionId}:${userId}:${key}`, value);
      return true;
    },
    async remove(extensionId, userId, key) {
      storageCalls.push(["remove", extensionId, userId, key]);
      backing.delete(`${extensionId}:${userId}:${key}`);
      return true;
    },
  };
  const hostUser = "host-user";
  const extHost = createExtension({ storage: fakeStorage });
  const hostSave = await extHost.extensionRequest({ method: "PUT", path: "/config", userId: hostUser, body: {
    roots: [{ path: mangaRoot, mode: "manga", label: "Host", enabled: true }],
  }});
  assert.equal(hostSave.status, 200, "host storage config save succeeds");
  const hostSet = storageCalls.filter(([op]) => op === "set");
  assert.ok(
    hostSet.some(([, extensionId, userId, key]) => extensionId === "local-source" && userId === hostUser && key === "local-source-config"),
    "storage.set is called with package id, user id and config key"
  );
  const storedValue = backing.get(`local-source:${hostUser}:local-source-config`);
  assert.equal(typeof storedValue, "string", "config is persisted as a serialized string");
  assert.ok(storedValue.includes('"roots"') && storedValue.includes(mangaRoot), "serialized config contains roots");

  // A fresh instance (simulating a server restart) reads back the config.
  const extReload = createExtension({ storage: fakeStorage });
  const restored = await extReload.extensionRequest({ method: "GET", path: "/config", userId: hostUser });
  assert.equal(restored.status, 200, "config restored from host storage");
  assert.equal(restored.body.roots.length, 1, "restored config has the root");
  assert.equal(restored.body.roots[0].path, mangaRoot, "restored root path matches");

  // Mappings persist through host storage and remove() is wired.
  const hostConfig = await extReload.extensionRequest({ method: "GET", path: "/config", userId: hostUser });
  const hostRootId = hostConfig.body.roots[0].id;
  const hostMappingKey = hostRootId + ":";
  const hostMangaId = encodeMangaId(hostRootId, "");
  await extReload.extensionRequest({ method: "PUT", path: "/mappings", userId: hostUser, body: {
    key: hostMappingKey, title: "Host Manga", cover: "https://example.invalid/cover.jpg",
  }});
  const mappedHost = await extReload.getMangaDetail(hostMangaId, { userId: hostUser });
  assert.equal(mappedHost.title, "Host Manga", "mapping persisted through host storage");

  // -- Remote cover redirect shape: { status, location } --------------------
  const coverTokenStr = mappedHost.coverUrl;
  assert.ok(coverTokenStr && coverTokenStr.startsWith("mangayomu-image://"), "mapped cover emits an image token");
  const coverQuery = new URLSearchParams(coverTokenStr.slice(coverTokenStr.indexOf("?") + 1));
  const redirect = await extReload.extensionRequest({
    method: "GET", path: "/image",
    query: { cover: coverQuery.get("cover"), file: coverQuery.get("file") },
    userId: hostUser,
  });
  assert.equal(redirect.status, 302, "remote cover returns a 302 redirect");
  assert.equal(redirect.location, "https://example.invalid/cover.jpg", "redirect exposes a top-level location");
  assert.equal(redirect.body, undefined, "redirect has no JSON body wrapper");

  await extReload.extensionRequest({ method: "DELETE", path: "/mappings/" + encodeURIComponent(hostMappingKey), userId: hostUser });
  const afterDelete = await extReload.getMangaDetail(hostMangaId, { userId: hostUser });
  assert.ok(afterDelete.title !== "Host Manga", "mapping deletion persists through host storage");
  const hostStored = JSON.parse(backing.get(`local-source:${hostUser}:local-source-config`));
  assert.equal(hostStored.mappings[hostMappingKey], undefined, "deleted mapping is absent from the stored config");

  // -- ZIP reader standalone ------------------------------------------------
  const entries = listZipImageEntries(cbz);
  assert.equal(entries.length, 2, "cbz reader lists 2 images");
  assert.deepEqual(entries.map((e) => e.name), ["001.jpg", "002.jpg"], "cbz images sorted");
  assert.ok(extractZipEntry(cbz, entries[1]).equals(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0x04])), "cbz stored extraction bytes");

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log("server.test: ok");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});