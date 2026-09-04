/**
 * Local Source — client contribution (self-contained ES module).
 *
 * Loaded asynchronously by the MangaYomu host when the package is installed
 * and the "local" source is enabled. It contains no npm imports and no
 * static link to the host bundle: every capability (request, component
 * creation, translation) comes from the host-provided global runtime
 * `window.MangaYomuExtensionRuntime` or from the explicitly supplied
 * `activate(runtime)` call.
 *
 * Host runtime contract (feature-detected):
 *   runtime.extensionId                     – package id ("local-source")
 *   runtime.sourceId                        – source id ("local")
 *   runtime.requestJson(extensionId, path, init) -> Promise<json>
 *   runtime.request(extensionId, path, init)     -> Promise<Response>
 *   runtime.registerPanel({sourceId, id, label, component})
 *   runtime.registerSettingsTab({sourceId, id, label, component})
 *   runtime.registerBrowseAction({sourceId, id, label, component})
 *   runtime.token() / runtime.apiBase       – optional; used to build
 *                                             authenticated image URLs
 *
 * The same panel is registered for a settings contribution and, when the
 * host supports it, as a Browse action for the Local Source.
 */

export const PACKAGE_ID = "local-source";
export const SOURCE_ID = "local";
export const IMAGE_SCHEME = "mangayomu-image://";

let activeRuntime = null;

function requestBaseUrl(runtime) {
  if (!runtime) return "";
  if (typeof runtime.apiBase === "function") return runtime.apiBase();
  if (typeof runtime.apiBase === "string") return runtime.apiBase;
  if (typeof runtime.baseUrl === "function") return runtime.baseUrl() + "/api";
  if (typeof runtime.baseUrl === "string") return runtime.baseUrl + "/api";
  return "";
}

function accessToken(runtime) {
  return runtime && typeof runtime.token === "function" ? runtime.token() : "";
}

export function setExtensionRuntime(runtime) {
  activeRuntime = runtime || null;
}

function idFor(runtime) {
  return (runtime && runtime.extensionId) || PACKAGE_ID;
}

/**
 * Call the extension request API. Returns parsed JSON.
 */
export async function extRequest(method, route, body, query) {
  const runtime = activeRuntime;
  if (!runtime || (typeof runtime.requestJson !== "function" && typeof runtime.request !== "function")) {
    throw new Error("MangaYomu extension runtime is not available");
  }
  let url = String(route || "");
  if (query && typeof query === "object") {
    const params = new URLSearchParams();
    for (const key of Object.keys(query)) {
      if (query[key] !== undefined && query[key] !== null && query[key] !== "") params.set(key, String(query[key]));
    }
    const qs = params.toString();
    if (qs) url += (url.includes("?") ? "&" : "?") + qs;
  }
  const init = { method };
  if (body !== undefined && body !== null) init.body = typeof body === "string" ? body : JSON.stringify(body);
  if (typeof runtime.requestJson === "function") return runtime.requestJson(idFor(runtime), url, init);
  const response = await runtime.request(idFor(runtime), url, init);
  if (!response || typeof response.json !== "function") return response;
  if (response.status >= 400) {
    const errorBody = await response.json().catch(() => ({}));
    throw new Error((errorBody && errorBody.error) || "Local Source request failed: " + response.status);
  }
  return response.json();
}

/**
 * Rewrite a `mangayomu-image://` token into an authenticated request URL the
 * reader can load directly (same pattern as the core image proxy).
 */
export function resolveImageUrl(url) {
  if (typeof url !== "string" || !url.startsWith(IMAGE_SCHEME)) return url;
  const suffix = url.slice(IMAGE_SCHEME.length);
  const base = requestBaseUrl(activeRuntime);
  const token = accessToken(activeRuntime);
  let resolved = base + "/extensions/" + idFor(activeRuntime) + "/request/" + suffix;
  if (token) resolved += (resolved.includes("?") ? "&" : "?") + "access_token=" + encodeURIComponent(token);
  return resolved;
}

/* ---------------------------------------------------------------------------
 * Settings panel — Local library
 * ------------------------------------------------------------------------- */

const LocalSourcePanel = {
  name: "LocalSourcePanel",

  template() {
    return /*html*/`
      <div class="space-y-8">
        <!-- Roots -->
        <section>
          <div class="mb-3 flex items-center justify-between gap-2">
            <h2 class="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              <span class="material-icons text-lg">folder</span>
              {{ t('Local folders') }}
            </h2>
            <button @click="newRoot"
              class="inline-flex shrink-0 items-center gap-0.5 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 cursor-pointer">
              <span class="material-icons text-base leading-none">add</span>
              {{ t('Add folder') }}
            </button>
          </div>
          <p class="mb-3 text-xs text-gray-400 dark:text-gray-500">
            {{ t('Choose folders on this server. Library folders contain one folder per manga; a manga folder is itself one manga.') }}
          </p>

          <div x-if="!roots.length" class="rounded-xl border border-dashed border-gray-300 p-5 text-sm text-gray-500 dark:border-gray-600 dark:text-gray-400">
            {{ t('No local folders yet. Add a folder to start reading your files.') }}
          </div>

          <div x-for="root in roots" :key="root.id" class="mb-2 flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3 dark:border-gray-700 dark:bg-gray-800">
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-medium text-gray-800 dark:text-gray-100">{{ root.label || root.path }}</p>
              <p class="truncate text-xs text-gray-400">{{ root.path }} · {{ root.mode === 'manga' ? t('Manga folder') : t('Library folder') }}</p>
            </div>
            <button @click="startEditRoot(root)" :title="t('Edit')"
              class="shrink-0 rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer">
              <span class="material-icons text-lg">edit</span>
            </button>
            <button @click="removeRoot(root.id)" :title="t('Remove')"
              class="shrink-0 rounded-lg p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40 cursor-pointer">
              <span class="material-icons text-lg">delete_outline</span>
            </button>
          </div>

          <!-- Root form -->
          <div x-show="rootFormOpen" class="mt-3 rounded-xl border border-blue-200 bg-blue-50/60 p-4 dark:border-blue-900 dark:bg-blue-950/40">
            <label class="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-200" for="ls-root-path">{{ t('Server folder path') }}</label>
            <input id="ls-root-path" x-model="rootForm.path" placeholder="/Volumes/Manga"
              class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100" />
            <div class="mt-3 grid grid-cols-2 gap-1 rounded-xl bg-gray-100 p-1 dark:bg-gray-900">
              <button @click="setRootMode('library')" :aria-pressed="rootForm.mode === 'library'"
                class="rounded-lg px-3 py-2 text-sm font-medium cursor-pointer"
                :class="rootForm.mode === 'library' ? 'bg-white text-gray-900 shadow dark:bg-gray-700 dark:text-gray-100' : 'text-gray-600 dark:text-gray-400'">
                {{ t('Library folder') }}
              </button>
              <button @click="setRootMode('manga')" :aria-pressed="rootForm.mode === 'manga'"
                class="rounded-lg px-3 py-2 text-sm font-medium cursor-pointer"
                :class="rootForm.mode === 'manga' ? 'bg-white text-gray-900 shadow dark:bg-gray-700 dark:text-gray-100' : 'text-gray-600 dark:text-gray-400'">
                {{ t('Manga folder') }}
              </button>
            </div>
            <label class="mb-1 mt-3 block text-sm font-medium text-gray-700 dark:text-gray-200" for="ls-root-label">{{ t('Label (optional)') }}</label>
            <input id="ls-root-label" x-model="rootForm.label" :placeholder="t('My manga')"
              class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100" />
            <div class="mt-4 flex justify-end gap-2">
              <button @click="closeRootForm"
                class="rounded-lg px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700 cursor-pointer">
                {{ t('Cancel') }}
              </button>
              <button @click="saveRoot" :disabled="busy || !rootForm.path.trim()"
                class="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 cursor-pointer">
                {{ rootForm.editing ? t('Save folder') : t('Add folder') }}
              </button>
            </div>
          </div>
        </section>

        <!-- Manga library -->
        <section>
          <div class="mb-3 flex items-center justify-between gap-2">
            <h2 class="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              <span class="material-icons text-lg">auto_stories</span>
              {{ t('Local manga') }}
            </h2>
            <button @click="rescan" :disabled="busy"
              class="inline-flex shrink-0 items-center gap-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 cursor-pointer dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800">
              <span class="material-icons text-base leading-none">refresh</span>
              {{ t('Rescan') }}
            </button>
          </div>

          <div x-if="!library.length" class="rounded-xl border border-dashed border-gray-300 p-5 text-sm text-gray-500 dark:border-gray-600 dark:text-gray-400">
            {{ t('Nothing scanned yet. Add a folder and rescan.') }}
          </div>

          <div class="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700 divide-y divide-gray-200 dark:divide-gray-700">
            <div x-for="item in library" :key="item.key" class="flex items-center gap-3 bg-white px-4 py-3 dark:bg-gray-800">
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-medium text-gray-800 dark:text-gray-100">
                  {{ item.mapping && item.mapping.title ? item.mapping.title : item.title }}
                  <span x-show="item.mapping && item.mapping.title" class="text-xs font-normal text-gray-400">· {{item.title}}</span>
                </p>
                <p class="text-xs text-gray-400">{{ item.chapterCount }} {{ t('chapters') }}</p>
                <p class="truncate text-xs text-gray-400">{{ item.rootPath }}/{{ item.relPath }}</p>
              </div>
              <button @click="openMapping(item)" :title="t('Edit metadata')"
                class="shrink-0 rounded-lg px-2.5 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/40 cursor-pointer">
                {{ item.mapping ? t('Edit') : t('Metadata') }}
              </button>
              <button x-show="item.mapping" @click="removeMapping(item)" :title="t('Remove mapping')"
                class="shrink-0 rounded-lg p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40 cursor-pointer">
                <span class="material-icons text-base">link_off</span>
              </button>
            </div>
          </div>
        </section>

        <p x-show="errors" class="text-sm text-red-600 dark:text-red-400">{{ errors }}</p>
        <p x-show="notice" class="text-sm text-green-700 dark:text-green-300">{{ notice }}</p>

        <!-- Mapping modal -->
        <div x-show="mappingModalOpen" class="fixed inset-0 z-[70] flex items-center justify-center p-4" role="dialog" :aria-modal="true">
          <div class="absolute inset-0 bg-black/60" @click="closeMapping"></div>
          <div class="relative z-10 max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-gray-200 bg-white p-5 shadow-xl dark:border-gray-700 dark:bg-gray-800">
            <div class="mb-4 flex items-center justify-between">
              <h3 class="text-lg font-semibold text-gray-900 dark:text-gray-100">{{ t('Manga metadata') }}</h3>
              <button @click="closeMapping" :aria-label="t('Close')"
                class="rounded-lg p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer">
                <span class="material-icons">close</span>
              </button>
            </div>
            <label class="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-200" for="ls-title">{{ t('Title') }}</label>
            <input id="ls-title" x-model="mappingForm.title" :placeholder="mappingTitleFallback"
              class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100" />
            <label class="mb-1 mt-3 block text-sm font-medium text-gray-700 dark:text-gray-200" for="ls-alt">{{ t('Alternative titles') }}</label>
            <input id="ls-alt" x-model="mappingForm.altTitle" placeholder="Yomi no Tsugai"
              class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100" />
            <label class="mb-1 mt-3 block text-sm font-medium text-gray-700 dark:text-gray-200" for="ls-author">{{ t('Author') }}</label>
            <input id="ls-author" x-model="mappingForm.author"
              class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100" />
            <label class="mb-1 mt-3 block text-sm font-medium text-gray-700 dark:text-gray-200" for="ls-status">{{ t('Status') }}</label>
            <input id="ls-status" x-model="mappingForm.status" placeholder="Ongoing"
              class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100" />
            <label class="mb-1 mt-3 block text-sm font-medium text-gray-700 dark:text-gray-200" for="ls-cover">{{ t('Cover') }}</label>
            <input id="ls-cover" x-model="mappingForm.cover" :placeholder="t('cover.jpg or https://…')"
              class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100" />
            <label class="mb-1 mt-3 block text-sm font-medium text-gray-700 dark:text-gray-200" for="ls-genres">{{ t('Genres (comma separated)') }}</label>
            <input id="ls-genres" x-model="mappingForm.genresText"
              class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100" />
            <label class="mb-1 mt-3 block text-sm font-medium text-gray-700 dark:text-gray-200" for="ls-desc">{{ t('Description') }}</label>
            <textarea id="ls-desc" x-model="mappingForm.description" rows="3"
              class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"></textarea>
            <div class="mt-5 flex justify-end gap-2">
              <button @click="closeMapping"
                class="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700 cursor-pointer">
                {{ t('Cancel') }}
              </button>
              <button @click="saveMapping" :disabled="busy"
                class="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 cursor-pointer">
                {{ t('Save metadata') }}
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
  },

  data() {
    return {
      roots: [],
      mappings: {},
      rootFormOpen: false,
      rootForm: { id: "", path: "", mode: "library", label: "", editing: false },
      library: [],
      mappingModalOpen: false,
      mappingKey: "",
      mappingTitleFallback: "",
      mappingForm: { title: "", altTitle: "", author: "", description: "", status: "", cover: "", genresText: "" },
      busy: false,
      errors: "",
      notice: "",
    };
  },

  async init() {
    this.data.errors.value = "";
    await this.reload();
  },

  async reload() {
    try {
      const config = await extRequest("GET", "/config");
      this.data.roots.value = (config && config.roots) || [];
      this.data.mappings.value = (config && config.mappings) || {};
      const library = await extRequest("GET", "/library");
      this.data.library.value = (library && library.manga) || [];
      this.data.notice.value = "";
    } catch (err) {
      this.data.errors.value = err.message;
    }
  },

  async rescan() {
    this.data.busy.value = true;
    this.data.errors.value = "";
    try {
      const summary = await extRequest("POST", "/rescan");
      await this.reload();
      this.data.notice.value = summary && summary.manga !== undefined
        ? `Scanned ${summary.manga} manga from ${summary.roots} folder(s).`
        : "Library rescanned.";
    } catch (err) {
      this.data.errors.value = err.message;
    } finally {
      this.data.busy.value = false;
    }
  },

  newRoot() {
    this.data.rootForm.value = { id: "", path: "", mode: "library", label: "", editing: false };
    this.data.rootFormOpen.value = true;
    this.data.errors.value = "";
  },

  startEditRoot(root) {
    this.data.rootForm.value = { id: root.id, path: root.path, mode: root.mode, label: root.label || "", editing: true };
    this.data.rootFormOpen.value = true;
  },

  setRootMode(mode) {
    this.data.rootForm.value.mode = mode;
  },

  closeRootForm() {
    this.data.rootFormOpen.value = false;
  },

  async saveRoot() {
    const form = this.data.rootForm.value;
    if (!form.path.trim()) return;
    this.data.busy.value = true;
    this.data.errors.value = "";
    try {
      const roots = this.data.roots.value.map((root) => ({
        id: root.id,
        path: root.path,
        mode: root.mode,
        label: root.label || "",
        enabled: root.enabled !== false,
      }));
      if (form.editing) {
        const target = roots.find((root) => root.id === form.id);
        if (target) {
          target.path = form.path.trim();
          target.mode = form.mode;
          target.label = form.label.trim();
        }
      } else {
        roots.push({ id: "", path: form.path.trim(), mode: form.mode, label: form.label.trim(), enabled: true });
      }
      await extRequest("PUT", "/config", { roots, mappings: this.data.mappings.value });
      this.data.rootFormOpen.value = false;
      await this.reload();
      await this.rescan();
    } catch (err) {
      this.data.errors.value = err.message;
    } finally {
      this.data.busy.value = false;
    }
  },

  async removeRoot(rootId) {
    this.data.busy.value = true;
    this.data.errors.value = "";
    try {
      const roots = this.data.roots.value.filter((root) => root.id !== rootId);
      await extRequest("PUT", "/config", { roots, mappings: this.data.mappings.value });
      await this.reload();
      await this.rescan();
    } catch (err) {
      this.data.errors.value = err.message;
    } finally {
      this.data.busy.value = false;
    }
  },

  openMapping(item) {
    const mapping = item.mapping || {};
    this.data.mappingKey.value = item.key;
    this.data.mappingTitleFallback.value = item.title || "";
    this.data.mappingForm.value = {
      title: mapping.title || "",
      altTitle: mapping.altTitle || "",
      author: mapping.author || "",
      description: mapping.description || "",
      status: mapping.status || "",
      cover: mapping.cover || "",
      genresText: mapping.genres ? mapping.genres.join(", ") : "",
    };
    this.data.mappingModalOpen.value = true;
    this.data.errors.value = "";
  },

  closeMapping() {
    this.data.mappingModalOpen.value = false;
  },

  async saveMapping() {
    const form = this.data.mappingForm.value;
    this.data.busy.value = true;
    this.data.errors.value = "";
    try {
      await extRequest("PUT", "/mappings", {
        key: this.data.mappingKey.value,
        title: form.title,
        altTitle: form.altTitle,
        author: form.author,
        description: form.description,
        status: form.status,
        cover: form.cover,
        genres: form.genresText ? form.genresText.split(",").map((g) => g.trim()).filter(Boolean) : [],
      });
      this.data.mappingModalOpen.value = false;
      await this.reload();
    } catch (err) {
      this.data.errors.value = err.message;
    } finally {
      this.data.busy.value = false;
    }
  },

  async removeMapping(item) {
    this.data.busy.value = true;
    this.data.errors.value = "";
    try {
      await extRequest("DELETE", "/mappings/" + encodeURIComponent(item.key));
      await this.reload();
    } catch (err) {
      this.data.errors.value = err.message;
    } finally {
      this.data.busy.value = false;
    }
  },
};

export { LocalSourcePanel };

/* ---------------------------------------------------------------------------
 * Registration
 * ------------------------------------------------------------------------- */

export const settingsPanel = {
  sourceId: SOURCE_ID,
  id: "local-library",
  label: "Local library",
  component: LocalSourcePanel,
};

/**
 * Host activation. The MangaYomu host imports this module asynchronously and
 * calls the default export with its host runtime; the returned descriptors
 * let the host hub mount the panels. Optional runtime.registerPanel is still
 * honoured when the host provides it (legacy/self-registration path).
 */
export function activate(runtime) {
  activeRuntime = runtime || null;
  if (runtime && typeof runtime.registerPanel === "function") {
    runtime.registerPanel(settingsPanel);
  }
  return {
    settingsPanel: LocalSourcePanel,
    browsePanel: LocalSourcePanel,
  };
}

// Self-registration when the host loads this module in a browser context and
// already installed the global runtime before the import ran.
if (typeof window !== "undefined" && window.MangaYomuExtensionRuntime) {
  activate(window.MangaYomuExtensionRuntime);
}

export default activate;