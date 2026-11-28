import {
  addFavorite,
  favoriteKey,
  isVideoUrl,
  loadRecents,
  normalizeGifLink,
  removeFavorite,
  searchGiphy,
  watchFavorites,
  watchGiphyKey,
  type Favorite,
  type GifMedia,
  type GiphyKind,
} from "./gifs";

// Sélecteur de GIF façon Discord : onglets GIF / Autocollants, une barre de
// recherche (qui reconnaît aussi un lien collé), puis des tuiles illustrées
// (Favoris, À la une, Récents, catégories) qui ouvrent leurs résultats.
// Utilisé par la console Re:log (envoi au clic) et par les salons (poser un GIF).

const CATEGORIES = ["mdr", "gg", "bravo", "choqué", "triste", "rage", "oui", "non", "hype", "merci", "bonne nuit", "danse"];
const SEARCH_DELAY_MS = 350;
/** Les images des tuiles coûtent une recherche GIPHY chacune : gardées 3 jours. */
const COVER_TTL_MS = 3 * 24 * 3600 * 1000;
const coverKey = (kind: GiphyKind) => `kos.gp.covers.${kind}`;

const STYLE = `
.gp { display: grid; gap: 10px; }
.gp-kinds { display: flex; gap: 4px; }
.gp-kinds button { border: 0; background: transparent; padding: 6px 12px; border-radius: 6px; color: var(--text-dim); font-weight: 700; font-size: 13px; }
.gp-kinds button:hover { background: rgba(255,255,255,0.05); color: var(--text-main); }
.gp-kinds button.on { background: rgba(255,255,255,0.1); color: var(--text-main); }
.gp-search { position: relative; }
.gp-search input { width: 100%; padding: 9px 34px 9px 34px; border-radius: 8px; border: 2px solid var(--border); background: #000; }
.gp-search input:focus { border-color: var(--accent-neon); }
.gp-search .ico { position: absolute; left: 11px; top: 50%; transform: translateY(-50%); color: var(--text-dim); pointer-events: none; font-size: 14px; }
.gp-search .clear { position: absolute; right: 6px; top: 50%; transform: translateY(-50%); border: 0; background: transparent; color: var(--text-dim); padding: 4px 8px; font-size: 14px; }
.gp-search .clear:hover { color: var(--text-main); background: transparent; }
.gp-head { display: flex; align-items: center; gap: 8px; font-weight: 700; font-size: 14px; }
.gp-head button { border: 0; background: transparent; padding: 4px 8px; font-size: 16px; color: var(--text-dim); }
.gp-head button:hover { color: var(--text-main); background: transparent; }
.gp-scroll { max-height: var(--gp-max, 460px); overflow-y: auto; padding-right: 2px; scrollbar-width: thin; }

.gp-cats { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; }
.gp-cat { position: relative; height: 96px; border-radius: 8px; overflow: hidden; cursor: pointer; background: #1c1f24 center / cover no-repeat; border: 0; padding: 0; }
.gp-cat::before { content: ""; position: absolute; inset: 0; background: rgba(0,0,0,0.55); transition: background 0.15s; }
.gp-cat:hover::before { background: rgba(0,0,0,0.35); }
.gp-cat.accent::before { background: color-mix(in srgb, var(--accent-neon) 55%, transparent); }
.gp-cat.accent:hover::before { background: color-mix(in srgb, var(--accent-neon) 40%, transparent); }
.gp-cat span { position: relative; color: #fff; font-weight: 800; font-size: 15px; text-shadow: 0 1px 4px rgba(0,0,0,0.8); display: flex; align-items: center; justify-content: center; gap: 6px; height: 100%; padding: 0 8px; text-align: center; }

.gp-grid { columns: var(--gp-min, 150px); column-gap: 6px; }
.gp-tile { position: relative; break-inside: avoid; margin-bottom: 6px; border-radius: 6px; overflow: hidden; cursor: pointer; border: 2px solid transparent; background: #000; min-height: 40px; }
.gp-tile.sticker { background: repeating-conic-gradient(#1a1d21 0 25%, #111316 0 50%) 0 0 / 14px 14px; }
.gp-tile img, .gp-tile video { width: 100%; display: block; pointer-events: none; }
.gp-tile:hover { border-color: rgba(255,255,255,0.35); }
.gp-tile.sel { border-color: var(--accent-neon); }
.gp-tile .gp-flash { position: absolute; inset: 0; display: grid; place-items: center; background: rgba(0,0,0,0.65); color: var(--status-online); font-weight: 800; font-size: 13px; opacity: 0; transition: opacity 0.2s; pointer-events: none; }
.gp-tile.flash .gp-flash { opacity: 1; }
.gp-tile.flash.err .gp-flash { color: var(--status-offline); }
.gp-star { position: absolute; top: 4px; right: 4px; width: 28px; height: 28px; padding: 0; border-radius: 50%; background: rgba(0,0,0,0.65); border: 0; color: #fff; font-size: 15px; opacity: 0; }
.gp-tile:hover .gp-star, .gp-star.fav { opacity: 1; }
.gp-star.fav { color: #ffd34d; }
.gp-empty { color: var(--text-dim); font-size: 12px; padding: 28px 8px; text-align: center; border: 1px dashed var(--border); border-radius: 8px; }
.gp-more { width: 100%; margin-top: 4px; }
.gp-credit { font-size: 10px; color: var(--text-dim); text-align: right; letter-spacing: 1px; margin-top: 6px; }
.gp-hint { font-size: 11px; color: var(--text-dim); margin: 0 0 8px; }
`;

function injectStyleOnce() {
  if (document.getElementById("gp-style")) return;
  const style = document.createElement("style");
  style.id = "gp-style";
  style.textContent = STYLE;
  document.head.appendChild(style);
}

type View =
  | { name: "home" }
  | { name: "results"; title: string; query: string }
  | { name: "favorites" }
  | { name: "recents" }
  | { name: "link"; gif: GifMedia };

export interface GifPicker {
  /** À appeler après un envoi : met à jour la vue Récents. */
  refresh(): void;
  /** Petit retour visuel sur la vignette du GIF (ex : "Envoyé ✓"). */
  flash(url: string, text: string, isError?: boolean): void;
}

export function mountGifPicker(
  container: HTMLElement,
  opts: {
    me: string;
    onPick: (gif: GifMedia) => void;
    /** Garder la vignette choisie en surbrillance (mode "choisir puis placer"). */
    keepSelection?: boolean;
    onError?: (message: string) => void;
  },
): GifPicker {
  injectStyleOnce();
  container.classList.add("gp");
  container.innerHTML = `
    <div class="gp-kinds"><button data-kind="gifs">GIF</button><button data-kind="stickers" title="Transparents, posés sans cadre">Autocollants</button></div>
    <div class="gp-search">
      <span class="ico">🔍</span>
      <input type="search" placeholder="Rechercher sur GIPHY, ou coller un lien" autocomplete="off" />
      <button class="clear" title="Effacer" hidden>✕</button>
    </div>
    <div class="gp-scroll"><div class="gp-body"></div></div>`;

  const q = <T extends HTMLElement>(sel: string) => container.querySelector<T>(sel)!;
  const body = q(".gp-body");
  const scroller = q(".gp-scroll");
  const input = q<HTMLInputElement>(".gp-search input");
  const clearBtn = q<HTMLButtonElement>(".gp-search .clear");
  const onError = opts.onError ?? (() => {});

  let favorites: Record<string, Favorite> = {};
  let giphyKey: string | null = null;
  let selectedUrl: string | null = null;
  let kind: GiphyKind = "gifs";
  let view: View = { name: "home" };
  let results: GifMedia[] = [];
  let loading = false;
  let exhausted = false;
  let token = 0;
  let debounce: ReturnType<typeof setTimeout> | undefined;
  const tiles = new Map<string, HTMLElement>();
  let covers: Record<string, string> = loadCovers(kind);
  let coversLoading = false;

  // --- Images des tuiles (mises en cache) ---

  function loadCovers(k: GiphyKind): Record<string, string> {
    try {
      const raw = JSON.parse(localStorage.getItem(coverKey(k)) || "{}");
      return raw.ts && Date.now() - raw.ts < COVER_TTL_MS ? raw.map ?? {} : {};
    } catch {
      return {};
    }
  }
  function saveCovers() {
    try {
      localStorage.setItem(coverKey(kind), JSON.stringify({ ts: Date.now(), map: covers }));
    } catch {
      /* stockage indisponible : les images seront rechargées */
    }
  }
  async function fetchCovers() {
    if (!giphyKey || coversLoading) return;
    const missing = ["__trending", ...CATEGORIES].filter((t) => !covers[t]);
    if (!missing.length) return;
    coversLoading = true;
    const forKind = kind;
    for (const term of missing) {
      try {
        const [first] = await searchGiphy(giphyKey, term === "__trending" ? "" : term, { kind: forKind, limit: 1 });
        if (forKind !== kind) break;
        if (first) covers[term] = first.preview || first.url;
        saveCovers();
        if (view.name === "home") paintCovers();
      } catch {
        break; // limite atteinte ou réseau : on garde les tuiles sans image
      }
    }
    coversLoading = false;
  }
  function paintCovers() {
    body.querySelectorAll<HTMLElement>(".gp-cat[data-cover]").forEach((el) => {
      const url = el.dataset.cover === "__favorites" ? favoriteCover() : el.dataset.cover === "__recents" ? loadRecents()[0]?.preview || loadRecents()[0]?.url : covers[el.dataset.cover!];
      if (url && !isVideoUrl(url)) el.style.backgroundImage = `url("${url.replace(/"/g, "%22")}")`;
    });
  }
  function favoriteCover() {
    const list = Object.values(favorites).sort((a, b) => b.addedAt - a.addedAt);
    const f = list.find((g) => !isVideoUrl(g.preview || g.url));
    return f ? f.preview || f.url : undefined;
  }

  // --- Vignettes de GIF ---

  function tile(gif: GifMedia): HTMLElement {
    const el = document.createElement("div");
    el.className = `gp-tile${gif.sticker ? " sticker" : ""}${opts.keepSelection && selectedUrl === gif.url ? " sel" : ""}`;
    el.title = gif.title || "";
    const src = gif.preview || gif.url;
    if (isVideoUrl(src)) {
      const v = document.createElement("video");
      Object.assign(v, { muted: true, autoplay: true, loop: true, playsInline: true, src });
      el.appendChild(v);
    } else {
      const img = document.createElement("img");
      img.loading = "lazy";
      img.src = src;
      img.alt = gif.title || "GIF";
      el.appendChild(img);
    }
    const isFav = !!favorites[favoriteKey(gif.url)];
    const star = document.createElement("button");
    star.className = `gp-star${isFav ? " fav" : ""}`;
    star.textContent = isFav ? "★" : "☆";
    star.title = isFav ? "Retirer des favoris" : "Ajouter aux favoris";
    star.addEventListener("click", (e) => {
      e.stopPropagation();
      const fav = !!favorites[favoriteKey(gif.url)]; // état actuel, pas celui à la création
      (fav ? removeFavorite(opts.me, gif.url) : addFavorite(opts.me, gif)).catch(() => onError("Favori non enregistré."));
    });
    const flash = document.createElement("div");
    flash.className = "gp-flash";
    el.append(star, flash);
    el.addEventListener("click", () => {
      selectedUrl = gif.url;
      if (opts.keepSelection) tiles.forEach((t, url) => t.classList.toggle("sel", url === gif.url));
      opts.onPick(gif);
    });
    tiles.set(gif.url, el);
    return el;
  }

  function head(title: string) {
    const h = document.createElement("div");
    h.className = "gp-head";
    const back = document.createElement("button");
    back.textContent = "←";
    back.title = "Retour";
    back.addEventListener("click", () => {
      input.value = "";
      go({ name: "home" });
    });
    const t = document.createElement("span");
    t.textContent = title;
    h.append(back, t);
    return h;
  }

  function grid(list: GifMedia[], emptyText: string) {
    if (!list.length) {
      const p = document.createElement("div");
      p.className = "gp-empty";
      p.textContent = emptyText;
      return p;
    }
    const g = document.createElement("div");
    g.className = "gp-grid";
    list.forEach((gif) => g.appendChild(tile(gif)));
    return g;
  }

  // --- Vues ---

  function catTile(label: string, cover: string, onClick: () => void, accent = false) {
    const b = document.createElement("button");
    b.className = `gp-cat${accent ? " accent" : ""}`;
    b.dataset.cover = cover;
    const s = document.createElement("span");
    s.textContent = label;
    b.appendChild(s);
    b.addEventListener("click", onClick);
    return b;
  }

  function render() {
    tiles.clear();
    body.replaceChildren();
    container.querySelectorAll<HTMLButtonElement>(".gp-kinds button").forEach((b) => b.classList.toggle("on", b.dataset.kind === kind));
    clearBtn.hidden = !input.value;
    const sticker = kind === "stickers";

    if (view.name === "home") {
      const cats = document.createElement("div");
      cats.className = "gp-cats";
      cats.append(
        catTile("★ Favoris", "__favorites", () => go({ name: "favorites" }), true),
        catTile(sticker ? "📈 Autocollants à la une" : "📈 GIF à la une", "__trending", () => go({ name: "results", title: "À la une", query: "" })),
        catTile("🕘 Récents", "__recents", () => go({ name: "recents" })),
        ...CATEGORIES.map((term) => catTile(term, term, () => go({ name: "results", title: term, query: term }))),
      );
      body.appendChild(cats);
      if (!giphyKey) {
        const p = document.createElement("p");
        p.className = "gp-hint";
        p.style.marginTop = "10px";
        p.textContent = "Recherche GIPHY pas encore activée (clé à ajouter dans la page Membres) : favoris, récents et liens collés fonctionnent.";
        body.appendChild(p);
      }
      paintCovers();
      fetchCovers();
      return;
    }

    if (view.name === "favorites") {
      const list = Object.values(favorites).sort((a, b) => b.addedAt - a.addedAt);
      body.append(head("★ Favoris"), grid(list, "Aucun favori : survole un GIF et clique sur ☆ pour le garder ici."));
      return;
    }
    if (view.name === "recents") {
      body.append(head("🕘 Récents"), grid(loadRecents(), "Les GIF que tu utilises apparaîtront ici."));
      return;
    }
    if (view.name === "link") {
      const p = document.createElement("p");
      p.className = "gp-hint";
      p.textContent = "Lien reconnu : clique sur le GIF pour l'utiliser.";
      const g = grid([view.gif], "");
      (g as HTMLElement).style.maxWidth = "260px";
      body.append(head("Lien collé"), p, g);
      return;
    }

    // Résultats de recherche ou d'une tuile
    body.appendChild(head(view.title === "À la une" ? (sticker ? "📈 Autocollants à la une" : "📈 GIF à la une") : `« ${view.title} »`));
    if (!giphyKey) {
      body.appendChild(grid([], "La recherche GIPHY n'est pas encore activée : Kashiro doit ajouter une clé GIPHY dans la page Membres."));
      return;
    }
    body.appendChild(grid(results, loading ? "Recherche du signal…" : "Aucun signal trouvé."));
    if (results.length) {
      if (!exhausted) {
        const more = document.createElement("button");
        more.className = "gp-more";
        more.textContent = loading ? "Recherche du signal…" : "Plus de résultats";
        more.disabled = loading;
        more.addEventListener("click", () => search(true));
        body.appendChild(more);
      }
      const credit = document.createElement("p");
      credit.className = "gp-credit";
      credit.textContent = "POWERED BY GIPHY";
      body.appendChild(credit);
    }
  }

  function go(next: View) {
    view = next;
    scroller.scrollTop = 0;
    if (next.name === "results") search(false);
    else render();
  }

  async function search(append: boolean) {
    if (view.name !== "results") return;
    if (!giphyKey) return render();
    const my = ++token;
    loading = true;
    if (!append) {
      results = [];
      exhausted = false;
    }
    render();
    try {
      const page = await searchGiphy(giphyKey, view.query, { offset: append ? results.length : 0, kind });
      if (my !== token) return;
      const known = new Set(results.map((r) => r.url));
      results = [...results, ...page.filter((g) => !known.has(g.url))];
      exhausted = page.length < 24;
    } catch (err) {
      if (my !== token) return;
      onError(err instanceof Error ? err.message : "Recherche impossible.");
    }
    loading = false;
    render();
  }

  // --- Barre de recherche (texte ou lien) ---

  function applyInput() {
    const text = input.value.trim();
    clearBtn.hidden = !text;
    if (!text) return go({ name: "home" });
    if (/^https?:\/\//i.test(text)) {
      const gif = normalizeGifLink(text);
      if (gif) return go({ name: "link", gif });
      onError("Lien non pris en charge : GIPHY, Tenor (média), Discord ou Imgur uniquement.");
      return;
    }
    go({ name: "results", title: text, query: text });
  }

  input.addEventListener("input", () => {
    clearTimeout(debounce);
    debounce = setTimeout(applyInput, SEARCH_DELAY_MS);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      clearTimeout(debounce);
      applyInput();
    }
    if (e.key === "Escape") {
      input.value = "";
      clearTimeout(debounce);
      applyInput();
    }
  });
  clearBtn.addEventListener("click", () => {
    input.value = "";
    applyInput();
    input.focus();
  });

  q(".gp-kinds").addEventListener("click", (e) => {
    const k = (e.target as HTMLElement).dataset.kind as GiphyKind | undefined;
    if (!k || k === kind) return;
    kind = k;
    covers = loadCovers(kind);
    if (view.name === "results") search(false);
    else render();
  });

  // Chargement automatique en bas de liste.
  scroller.addEventListener("scroll", () => {
    if (view.name !== "results" || loading || exhausted || !results.length) return;
    if (scroller.scrollTop + scroller.clientHeight > scroller.scrollHeight - 200) search(true);
  });

  watchFavorites(opts.me, (data) => {
    favorites = data;
    if (view.name === "favorites") return render();
    if (view.name === "home") paintCovers();
    tiles.forEach((el, url) => {
      const star = el.querySelector<HTMLButtonElement>(".gp-star")!;
      const fav = !!data[favoriteKey(url)];
      star.classList.toggle("fav", fav);
      star.textContent = fav ? "★" : "☆";
    });
  });
  watchGiphyKey((key) => {
    if (key === giphyKey) return;
    giphyKey = key;
    results = [];
    if (view.name === "results") search(false);
    else render();
  });

  render();

  return {
    refresh: () => {
      if (view.name === "recents") render();
    },
    flash(url, text, isError = false) {
      const el = tiles.get(url);
      if (!el) return;
      el.querySelector<HTMLElement>(".gp-flash")!.textContent = text;
      el.classList.toggle("err", isError);
      el.classList.add("flash");
      setTimeout(() => el.classList.remove("flash"), 1100);
    },
  };
}
