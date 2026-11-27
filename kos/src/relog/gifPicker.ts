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

// Sélecteur de GIF réutilisable : recherche GIPHY (GIF ou stickers, en direct
// pendant la frappe), suggestions rapides, favoris, récents, lien collé.
// Utilisé par la console Re:log (envoi au clic) et par les salons (poser un GIF).

const QUICK_TAGS = ["mdr", "gg", "bravo", "choqué", "triste", "non", "oui", "hype", "rage", "facepalm", "danse", "merci"];
const SEARCH_DELAY_MS = 350;

const STYLE = `
.gp { display: grid; gap: 8px; }
.gp-top { display: flex; gap: 6px; align-items: center; }
.gp-top input { flex: 1; min-width: 0; }
.gp-kind { display: inline-flex; background: #000; border: 1px solid var(--border); border-radius: 8px; padding: 2px; flex: none; }
.gp-kind button { border: 0; background: transparent; padding: 6px 10px; border-radius: 6px; color: var(--text-dim); font-size: 12px; }
.gp-kind button:hover { background: transparent; color: var(--text-main); }
.gp-kind button.on { background: var(--accent-low); color: var(--accent-neon); }
.gp-tags { display: flex; gap: 4px; overflow-x: auto; scrollbar-width: thin; padding-bottom: 2px; }
.gp-tags button { flex: none; padding: 4px 10px; border-radius: 999px; font-size: 12px; font-weight: 600; background: var(--panel-bg-alt); color: var(--text-dim); }
.gp-tags button.on { color: var(--accent-neon); border-color: var(--accent-neon); }
.gp-tabs { display: flex; gap: 2px; border-bottom: 1px solid var(--border); }
.gp-tabs button { background: transparent; border: 0; border-bottom: 2px solid transparent; border-radius: 0; padding: 7px 10px; color: var(--text-dim); font-size: 12px; }
.gp-tabs button:hover { background: transparent; border-color: transparent; color: var(--text-main); }
.gp-tabs button.on, .gp-tabs button.on:hover { color: var(--accent-neon); border-bottom-color: var(--accent-neon); }
.gp-scroll { max-height: var(--gp-max, 460px); overflow-y: auto; padding-right: 2px; scrollbar-width: thin; }
.gp-grid { columns: var(--gp-min, 120px); column-gap: 6px; }
.gp-tile { position: relative; break-inside: avoid; margin-bottom: 6px; border-radius: 6px; overflow: hidden; cursor: pointer; border: 2px solid transparent; background: #000; min-height: 40px; }
.gp-tile.sticker { background: repeating-conic-gradient(#1a1d21 0 25%, #111316 0 50%) 0 0 / 14px 14px; }
.gp-tile img, .gp-tile video { width: 100%; display: block; pointer-events: none; }
.gp-tile:hover { border-color: rgba(255,255,255,0.35); }
.gp-tile.sel { border-color: var(--accent-neon); }
.gp-tile .gp-flash { position: absolute; inset: 0; display: grid; place-items: center; background: rgba(0,0,0,0.65); color: var(--status-online); font-weight: 800; font-size: 13px; opacity: 0; transition: opacity 0.2s; pointer-events: none; }
.gp-tile.flash .gp-flash { opacity: 1; }
.gp-tile.flash.err .gp-flash { color: var(--status-offline); }
.gp-star { position: absolute; top: 4px; right: 4px; width: 26px; height: 26px; padding: 0; border-radius: 50%; background: rgba(0,0,0,0.65); border: 0; color: #fff; font-size: 14px; opacity: 0; }
.gp-tile:hover .gp-star, .gp-star.fav { opacity: 1; }
.gp-star.fav { color: #ffd34d; }
.gp-empty { color: var(--text-dim); font-size: 12px; padding: 24px 8px; text-align: center; border: 1px dashed var(--border); border-radius: 8px; }
.gp-more { width: 100%; margin-top: 4px; }
.gp-foot { display: flex; justify-content: space-between; align-items: center; font-size: 10px; color: var(--text-dim); letter-spacing: 1px; }
.gp-link { width: 100%; }
.gp-hint { font-size: 11px; color: var(--text-dim); margin: 0; }
.gp-link-preview { max-width: 220px; margin-top: 4px; }
`;

function injectStyleOnce() {
  if (document.getElementById("gp-style")) return;
  const style = document.createElement("style");
  style.id = "gp-style";
  style.textContent = STYLE;
  document.head.appendChild(style);
}

export interface GifPicker {
  /** À appeler après un envoi : met à jour l'onglet Récents. */
  refresh(): void;
  /** Petit retour visuel sur la vignette du GIF (ex : "Envoyé ✓"). */
  flash(url: string, text: string, isError?: boolean): void;
}

export function mountGifPicker(
  container: HTMLElement,
  opts: {
    me: string;
    /** Clic sur un GIF. */
    onPick: (gif: GifMedia) => void;
    /** Garder la vignette choisie en surbrillance (mode "choisir puis placer"). */
    keepSelection?: boolean;
    onError?: (message: string) => void;
  },
): GifPicker {
  injectStyleOnce();
  container.classList.add("gp");
  container.innerHTML = `
    <div class="gp-top">
      <input type="search" class="gp-q" placeholder="Rechercher un GIF..." autocomplete="off" />
      <div class="gp-kind"><button data-kind="gifs">GIF</button><button data-kind="stickers" title="GIF transparents, sans fond">Stickers</button></div>
    </div>
    <div class="gp-tags"></div>
    <div class="gp-tabs">
      <button data-tab="search">Tendances</button>
      <button data-tab="favorites">★ Favoris</button>
      <button data-tab="recents">Récents</button>
      <button data-tab="link">Lien</button>
    </div>
    <div class="gp-scroll"><div class="gp-body"></div></div>`;

  const q = <T extends HTMLElement>(sel: string) => container.querySelector<T>(sel)!;
  const body = q(".gp-body");
  const scroller = q(".gp-scroll");
  const input = q<HTMLInputElement>(".gp-q");
  const onError = opts.onError ?? (() => {});

  let favorites: Record<string, Favorite> = {};
  let giphyKey: string | null = null;
  let selectedUrl: string | null = null;
  let tab = "search";
  let kind: GiphyKind = "gifs";
  let query = "";
  let results: GifMedia[] = [];
  let loading = false;
  let exhausted = false;
  let searchToken = 0;
  let debounce: ReturnType<typeof setTimeout> | undefined;
  const tiles = new Map<string, HTMLElement>();

  // --- Vignettes ---

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

  function grid(list: GifMedia[], emptyText: string) {
    tiles.clear();
    body.replaceChildren();
    if (!list.length) {
      const p = document.createElement("div");
      p.className = "gp-empty";
      p.textContent = emptyText;
      body.appendChild(p);
      return;
    }
    const g = document.createElement("div");
    g.className = "gp-grid";
    list.forEach((gif) => g.appendChild(tile(gif)));
    body.appendChild(g);
  }

  // --- Onglets ---

  function render() {
    container.querySelectorAll<HTMLButtonElement>(".gp-tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
    container.querySelectorAll<HTMLButtonElement>(".gp-kind button").forEach((b) => b.classList.toggle("on", b.dataset.kind === kind));
    container.querySelectorAll<HTMLButtonElement>(".gp-tags button").forEach((b) => b.classList.toggle("on", b.textContent === query));
    q(".gp-tabs [data-tab=search]").textContent = query ? `« ${query} »` : "Tendances";

    if (tab === "search") {
      if (!giphyKey) return grid([], "La recherche GIPHY n'est pas encore activée : Kashiro doit ajouter une clé GIPHY dans la Forge. En attendant, utilise l'onglet Lien.");
      grid(results, loading ? "Chargement..." : "Aucun résultat.");
      if (results.length) {
        if (!exhausted) {
          const more = document.createElement("button");
          more.className = "gp-more";
          more.textContent = loading ? "Chargement..." : "Plus de résultats";
          more.disabled = loading;
          more.addEventListener("click", () => search(true));
          body.appendChild(more);
        }
        const foot = document.createElement("div");
        foot.className = "gp-foot";
        foot.innerHTML = `<span></span><span>POWERED BY GIPHY</span>`;
        body.appendChild(foot);
      }
    } else if (tab === "favorites") {
      grid(Object.values(favorites).sort((a, b) => b.addedAt - a.addedAt), "Aucun favori : clique sur ☆ en survolant un GIF pour le garder ici.");
    } else if (tab === "recents") {
      grid(loadRecents(), "Les GIF que tu utilises apparaîtront ici.");
    } else {
      tiles.clear();
      body.innerHTML = `
        <input class="gp-link" placeholder="Collez un lien GIPHY, Tenor (média), Discord ou Imgur puis Entrée" />
        <p class="gp-hint" style="margin-top:6px">Pages GIPHY acceptées telles quelles. Pour Tenor ou Discord : clic droit sur le GIF, « Copier l'adresse de l'image ».</p>
        <div class="gp-link-preview"></div>`;
      const link = body.querySelector<HTMLInputElement>(".gp-link")!;
      const use = () => {
        const gif = normalizeGifLink(link.value);
        if (!gif) return onError("Lien non pris en charge : GIPHY, Tenor (média), Discord ou Imgur uniquement.");
        const holder = body.querySelector(".gp-link-preview")!;
        holder.replaceChildren(Object.assign(document.createElement("div"), { className: "gp-grid" }));
        holder.firstElementChild!.appendChild(tile(gif));
        selectedUrl = gif.url;
        opts.onPick(gif);
      };
      link.addEventListener("keydown", (e) => e.key === "Enter" && use());
      link.addEventListener("paste", () => setTimeout(use, 0));
      setTimeout(() => link.focus(), 0);
    }
  }

  function show(name: string) {
    tab = name;
    if (name === "search" && giphyKey && !results.length && !loading) search(false);
    render();
    scroller.scrollTop = 0;
  }

  // --- Recherche ---

  async function search(append: boolean) {
    if (!giphyKey) return render();
    const token = ++searchToken;
    loading = true;
    if (!append) {
      results = [];
      exhausted = false;
    }
    render();
    try {
      const page = await searchGiphy(giphyKey, query, { offset: append ? results.length : 0, kind });
      if (token !== searchToken) return;
      const known = new Set(results.map((r) => r.url));
      results = [...results, ...page.filter((g) => !known.has(g.url))];
      exhausted = page.length < 24;
    } catch (err) {
      if (token !== searchToken) return;
      onError(err instanceof Error ? err.message : "Recherche impossible.");
    }
    loading = false;
    render();
  }

  function setQuery(text: string) {
    query = text.trim();
    tab = "search";
    clearTimeout(debounce);
    search(false);
  }

  input.addEventListener("input", () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => setQuery(input.value), SEARCH_DELAY_MS);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") setQuery(input.value);
    if (e.key === "Escape" && input.value) {
      input.value = "";
      setQuery("");
    }
  });

  const tags = q(".gp-tags");
  for (const t of QUICK_TAGS) {
    const b = document.createElement("button");
    b.textContent = t;
    b.addEventListener("click", () => {
      const next = query === t ? "" : t;
      input.value = next;
      setQuery(next);
    });
    tags.appendChild(b);
  }

  q(".gp-tabs").addEventListener("click", (e) => {
    const name = (e.target as HTMLElement).dataset.tab;
    if (name) show(name);
  });
  q(".gp-kind").addEventListener("click", (e) => {
    const k = (e.target as HTMLElement).dataset.kind as GiphyKind | undefined;
    if (!k || k === kind) return;
    kind = k;
    input.placeholder = kind === "stickers" ? "Rechercher un sticker..." : "Rechercher un GIF...";
    tab = "search";
    search(false);
  });

  // Chargement automatique en bas de liste.
  scroller.addEventListener("scroll", () => {
    if (tab !== "search" || loading || exhausted || !results.length) return;
    if (scroller.scrollTop + scroller.clientHeight > scroller.scrollHeight - 200) search(true);
  });

  watchFavorites(opts.me, (data) => {
    favorites = data;
    if (tab === "favorites") render();
    else tiles.forEach((el, url) => {
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
    if (tab === "search") show("search");
  });

  show("search");

  return {
    refresh: () => tab === "recents" && render(),
    flash(url, text, isError = false) {
      const el = tiles.get(url);
      if (!el) return;
      const f = el.querySelector<HTMLElement>(".gp-flash")!;
      f.textContent = text;
      el.classList.toggle("err", isError);
      el.classList.add("flash");
      setTimeout(() => el.classList.remove("flash"), 1100);
    },
  };
}
