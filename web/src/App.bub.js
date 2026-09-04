const BASE_URL = import.meta.env.BASE_URL;

export default {
  name: "OfficialExtensionsSite",

  /** @returns {string} */
  template() {
    return /*html*/ `
      <div class="min-h-screen overflow-x-hidden bg-[#f5f2eb] text-slate-950">
        <div class="pointer-events-none fixed inset-0 opacity-60" aria-hidden="true">
          <div class="absolute -left-32 -top-32 h-96 w-96 rounded-full bg-[#c8e5df] blur-3xl"></div>
          <div class="absolute right-0 top-24 h-[28rem] w-[28rem] rounded-full bg-[#f3d6b3] blur-3xl"></div>
        </div>

        <header class="relative mx-auto flex w-full max-w-7xl items-center justify-between px-6 py-6 sm:px-10 lg:px-12">
          <a :href="baseUrl()" class="group flex items-center gap-3" aria-label="MangaYomu Official Extensions home">
            <span class="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-950 text-lg font-bold text-[#f5f2eb] shadow-lg shadow-slate-950/15 transition-transform group-hover:-rotate-6">M</span>
            <span class="font-display text-sm font-bold tracking-tight sm:text-base">MangaYomu <span class="font-normal text-slate-500">/ official extensions</span></span>
          </a>
          <a :href="repositoryUrl()" target="_blank" rel="noreferrer" class="hidden items-center gap-2 rounded-full border border-slate-300/80 bg-white/60 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-950 hover:bg-white sm:inline-flex">
            <span>repository.json</span>
            <span aria-hidden="true">↗</span>
          </a>
        </header>

        <main class="relative mx-auto w-full max-w-7xl px-6 pb-16 sm:px-10 lg:px-12">
          <section class="grid items-end gap-12 pb-20 pt-12 lg:grid-cols-[1.15fr_0.85fr] lg:gap-20 lg:pb-28 lg:pt-20">
            <div>
              <p class="mb-6 flex items-center gap-3 text-xs font-bold uppercase tracking-[0.24em] text-teal-700">
                <span class="h-px w-8 bg-teal-600"></span>
                Official extension repository
              </p>
              <h1 class="max-w-4xl font-display text-5xl font-bold leading-[0.98] tracking-[-0.06em] sm:text-7xl lg:text-[6.8rem]">
                Read your own library.<br />
                <span class="text-teal-700">Anywhere on the server.</span>
              </h1>
              <p class="mt-8 max-w-xl text-lg leading-8 text-slate-600 sm:text-xl">
                Official MangaYomu extensions, maintained by the MangaYomu project — starting with Local Source for your own manga folders.
              </p>
              <div class="mt-10 flex flex-wrap items-center gap-3">
                <a href="#packages" class="inline-flex items-center gap-3 rounded-full bg-slate-950 px-6 py-3.5 text-sm font-bold text-white shadow-xl shadow-slate-950/15 transition hover:-translate-y-0.5 hover:bg-teal-800">
                  Explore extensions
                  <span aria-hidden="true">↓</span>
                </a>
                <button type="button" @click="copyRepositoryUrl" class="inline-flex items-center gap-3 rounded-full border border-slate-300 bg-white/60 px-6 py-3.5 text-sm font-bold text-slate-700 transition hover:border-slate-950 hover:bg-white">
                  <span>{{ copied ? 'Repository URL copied' : 'Copy repository URL' }}</span>
                  <span aria-hidden="true">{{ copied ? '✓' : '⧉' }}</span>
                </button>
              </div>
            </div>

            <div class="relative mx-auto w-full max-w-md lg:pb-5">
              <div class="rotate-[-4deg] rounded-[2rem] border border-slate-950/10 bg-slate-950 p-3 shadow-soft transition-transform hover:rotate-[-2deg]">
                <div class="overflow-hidden rounded-[1.4rem] bg-[#e4eee8]">
                  <div class="flex items-center justify-between border-b border-slate-950/10 px-5 py-4">
                    <div class="flex gap-1.5"><span class="h-2.5 w-2.5 rounded-full bg-rose-400"></span><span class="h-2.5 w-2.5 rounded-full bg-amber-300"></span><span class="h-2.5 w-2.5 rounded-full bg-emerald-400"></span></div>
                    <span class="font-mono text-[10px] font-bold uppercase tracking-widest text-slate-500">extension.json</span>
                  </div>
                  <div class="space-y-5 px-5 py-6 font-mono text-xs leading-6 text-slate-700 sm:px-8 sm:py-8">
                    <p><span class="text-teal-700">{</span></p>
                    <p class="pl-4"><span class="text-slate-500">"id"</span>: <span class="text-amber-700">"local-source"</span>,</p>
                    <p class="pl-4"><span class="text-slate-500">"version"</span>: <span class="text-amber-700">"1.0.0"</span>,</p>
                    <p class="pl-4"><span class="text-slate-500">"tags"</span>: <span class="text-teal-700">[</span></p>
                    <p class="pl-8"><span class="text-amber-700">"source"</span>, <span class="text-amber-700">"official"</span>, <span class="text-amber-700">"local"</span></p>
                    <p class="pl-4"><span class="text-teal-700">]</span>,</p>
                    <p class="pl-4"><span class="text-slate-500">"contributes"</span>: <span class="text-teal-700">{</span> <span class="text-slate-500">"sources"</span>: <span class="text-teal-700">[</span><span class="text-amber-700">"local"</span><span class="text-teal-700">]</span> <span class="text-teal-700">}</span></p>
                    <p><span class="text-teal-700">}</span></p>
                  </div>
                </div>
              </div>
              <div class="absolute -bottom-4 -right-2 rounded-2xl bg-[#f0b37e] px-4 py-3 text-xs font-bold uppercase tracking-wider text-slate-950 shadow-lg shadow-orange-900/10 sm:-right-7">
                Ready to install
              </div>
            </div>
          </section>

          <section class="grid gap-4 border-y border-slate-950/10 py-8 text-sm text-slate-600 sm:grid-cols-3 sm:gap-8">
            <div class="flex gap-4"><span class="font-display text-2xl font-bold text-slate-950">01</span><p><strong class="block text-slate-950">Add the repository</strong>Paste the catalog URL in MangaYomu settings.</p></div>
            <div class="flex gap-4"><span class="font-display text-2xl font-bold text-slate-950">02</span><p><strong class="block text-slate-950">Choose an extension</strong>Browse the packages available below.</p></div>
            <div class="flex gap-4"><span class="font-display text-2xl font-bold text-slate-950">03</span><p><strong class="block text-slate-950">Start reading</strong>Install a package and enable its source.</p></div>
          </section>

          <section id="packages" class="pt-20 lg:pt-28">
            <div class="mb-10 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
              <div>
                <p class="mb-3 text-xs font-bold uppercase tracking-[0.24em] text-teal-700">The collection</p>
                <h2 class="font-display text-4xl font-bold tracking-[-0.04em] sm:text-5xl">Official extensions</h2>
              </div>
              <p x-if="repository" class="max-w-xs text-sm leading-6 text-slate-500">{{ repository.packages.length }} package{{ repository.packages.length === 1 ? '' : 's' }} in the catalog.</p>
            </div>

            <div x-if="loading" class="rounded-[2rem] border border-slate-950/10 bg-white/50 p-8 text-slate-500">Loading the extension catalog…</div>
            <div x-if="error" class="rounded-[2rem] border border-rose-300 bg-rose-50 p-8 text-rose-800">{{ error }}</div>
            <div x-if="repository && !loading && !error" class="grid gap-5 lg:grid-cols-2">
              <article x-for="pkg in repository.packages" :key="pkg.id" class="group flex min-h-[22rem] flex-col justify-between rounded-[2rem] border border-slate-950/10 bg-white/75 p-7 shadow-sm backdrop-blur transition hover:-translate-y-1 hover:border-slate-950/25 hover:shadow-soft sm:p-9">
                <div>
                  <div class="mb-10 flex items-start justify-between gap-4">
                    <div class="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#e4eee8] font-display text-2xl font-bold text-teal-800 transition group-hover:rotate-6">{{ pkg.name.charAt(0) }}</div>
                    <span class="rounded-full border border-slate-200 px-3 py-1 text-xs font-bold text-slate-500">v{{ pkg.version }}</span>
                  </div>
                  <h3 class="font-display text-3xl font-bold tracking-[-0.04em]">{{ pkg.name }}</h3>
                  <p class="mt-3 max-w-md text-sm leading-6 text-slate-500">Read manga from folders on your MangaYomu server — a normal source for favorites, progress, and the reader.</p>
                  <div class="mt-5 flex flex-wrap gap-2">
                    <span x-for="tag in pkg.tags" :key="tag" class="rounded-full bg-[#f5f2eb] px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-slate-600">{{ tag }}</span>
                  </div>
                </div>
                <div class="mt-10 flex flex-wrap items-center gap-3 border-t border-slate-950/10 pt-5">
                  <a :href="assetUrl(pkg.url)" class="inline-flex items-center gap-2 rounded-full bg-slate-950 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-teal-800" download>
                    Download ZIP <span aria-hidden="true">↓</span>
                  </a>
                  <a :href="assetUrl('packages/' + pkg.id + '/extension.json')" target="_blank" rel="noreferrer" class="rounded-full px-3 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-100 hover:text-slate-950">Manifest ↗</a>
                  <a :href="assetUrl('packages/' + pkg.id + '/server/index.mjs')" target="_blank" rel="noreferrer" class="rounded-full px-3 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-100 hover:text-slate-950">Source ↗</a>
                </div>
              </article>
            </div>
          </section>

          <section class="mt-20 overflow-hidden rounded-[2rem] bg-slate-950 px-7 py-10 text-white sm:px-12 sm:py-14 lg:mt-28 lg:flex lg:items-center lg:justify-between lg:gap-12">
            <div>
              <p class="mb-3 text-xs font-bold uppercase tracking-[0.24em] text-[#9ed5c8]">Install in MangaYomu</p>
              <h2 class="max-w-xl font-display text-3xl font-bold tracking-[-0.04em] sm:text-4xl">Bring the catalog to your library in seconds.</h2>
            </div>
            <div class="mt-8 flex max-w-md shrink-0 items-center gap-3 rounded-2xl border border-white/15 bg-white/10 p-3 lg:mt-0">
              <code class="min-w-0 flex-1 truncate px-2 text-xs text-slate-300">{{ repositoryUrl() }}</code>
              <button type="button" @click="copyRepositoryUrl" class="shrink-0 rounded-xl bg-[#f0b37e] px-4 py-2.5 text-xs font-bold text-slate-950 transition hover:bg-[#f7c596]">{{ copied ? 'Copied' : 'Copy' }}</button>
            </div>
          </section>
        </main>

        <footer class="relative mx-auto flex w-full max-w-7xl flex-col gap-3 border-t border-slate-950/10 px-6 py-8 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between sm:px-10 lg:px-12">
          <p>Official extensions for MangaYomu readers.</p>
          <a :href="repositoryUrl()" target="_blank" rel="noreferrer" class="font-semibold text-slate-700 transition hover:text-teal-700">Open repository catalog ↗</a>
        </footer>
      </div>
    `;
  },

  /** @returns {{repository: object|null, loading: boolean, error: string, copied: boolean}} */
  data() {
    return {
      repository: null,
      loading: true,
      error: "",
      copied: false,
    };
  },

  /** @returns {void} */
  init() {
    this._copyTimer = null;
    this.loadRepository();
  },

  /** @returns {void} */
  beforeDestroy() {
    if (this._copyTimer) window.clearTimeout(this._copyTimer);
  },

  /** @returns {string} */
  baseUrl() {
    return BASE_URL;
  },

  /** @returns {string} */
  repositoryUrl() {
    return new URL("repository.json", new URL(BASE_URL, window.location.origin)).href;
  },

  /** @param {string} path @returns {string} */
  assetUrl(path) {
    if (/^https?:\/\//i.test(path)) return path;
    return BASE_URL + path.replace(/^\//, "");
  },

  /** @returns {Promise<void>} */
  async loadRepository() {
    try {
      const response = await fetch(this.repositoryUrl());
      if (!response.ok) throw new Error(`Could not load the extension catalog (${response.status}).`);
      const repository = await response.json();
      this.data.repository.value = repository;
    } catch (error) {
      this.data.error.value = error && error.message ? error.message : "Could not load the extension catalog.";
    } finally {
      this.data.loading.value = false;
    }
  },

  /** @returns {Promise<void>} */
  async copyRepositoryUrl() {
    const url = this.repositoryUrl();
    if (this._copyTimer) window.clearTimeout(this._copyTimer);
    this.data.copied.value = true;
    this._copyTimer = window.setTimeout(() => {
      this.data.copied.value = false;
      this._copyTimer = null;
    }, 2200);
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(url);
      } else {
        const input = document.createElement("textarea");
        input.value = url;
        input.setAttribute("readonly", "");
        input.style.position = "fixed";
        input.style.opacity = "0";
        document.body.appendChild(input);
        input.select();
        document.execCommand("copy");
        input.remove();
      }
    } catch (error) {
      console.warn("Could not copy repository URL", error);
    }
  },
};