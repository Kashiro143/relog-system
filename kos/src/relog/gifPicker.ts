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
} from "./gifs";

// Sélecteur de GIF réutilisable : recherche GIPHY, favoris, récents, lien collé.
// Utilisé par la console Re:log (envoi) et par les salons (poser un GIF).

const STYLE = `
.gp-tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--border); margin-bottom: 10px; }
.gp-tabs button { background: transparent; border: 0; border-bottom: 2px solid transparent; border-radius: 0; padding: 8px 12px; color: var(--text-dim); }
.gp-tabs button:hover { background: transparent; border-color: transparent; color: var(--text-main); }
.gp-tabs button.on, .gp-tabs button.on:hover { color: var(--accent-neon); border-bottom-color: var(--accent-neon); }
.gp-searchbar { display: flex; gap: 6px; margin-bottom: 10px; }
.gp-searchbar input { flex: 1; min-width: 0; }
.gp-link { width: 100%; }
.gp-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(var(--gp-min, 110px), 1fr)); gap: 6px; max-height: var(--gp-max, 420px); overflow-y: auto; padding-right: 2px; }
.gp-tile { position: relative; aspect-ratio: 4 / 3; border-radius: 6px; overflow: hidden; background: #000; cursor: pointer; border: 2px solid transparent; }
.gp-tile img, .gp-tile video { width: 100%; height: 100%; object-fit: cover; display: block; pointer-events: none; }
.gp-tile.sel { border-color: var(--accent-neon); }
.gp-star { position: absolute; top: 4px; right: 4px; width: 26px; height: 26px; padding: 0; border-radius: 50%; background: rgba(0,0,0,0.65); border: 0; color: #fff; font-size: 14px; opacity: 0; }
.gp-tile:hover .gp-star, .gp-star.fav { opacity: 1; }
.gp-star.fav { color: #ffd34d; }
.gp-empty { grid-column: 1 / -1; color: var(--text-dim); font-size: 12px; padding: 24px 8px; text-align: center; border: 1px dashed var(--border); border-radius: 8px; }
.gp-hint { font-size: 11px; color: var(--text-dim); margin: 8px 0 0; }
.gp-credit { font-size: 10px; color: var(--text-dim); text-align: right; margin-top: 6px; letter-spacing: 1px; }
`;

function injectStyleOnce() {
  if (document.getElementById("gp-style")) return;
  const style = document.createElement("style");
  style.id = "gp-style";
  style.textContent = STYLE;
  document.head.appendChild(style);
}

export interface GifPicker {
  selected(): GifMedia | null;
  /** À appeler après un envoi : met à jour l'onglet Récents. */
  refresh(): void;
}

export function mountGifPicker(
  container: HTMLElement,
  opts: { me: string; onSelect: (gif: GifMedia) => void; onError?: (message: string) => void },
): GifPicker {
  injectStyleOnce();
  container.innerHTML = `
    <div class="gp-tabs">
      <button data-tab="search">Recherche</button>
      <button data-tab="favorites">Favoris</button>
      <button data-tab="recents">Récents</button>
      <button data-tab="link">Lien</button>
    </div>
    <div data-pane="search">
      <form class="gp-searchbar">
        <input type="search" placeholder="Rechercher sur GIPHY (vide = tendances)" autocomplete="off" />
        <button type="submit">Rechercher</button>
      </form>
      <div class="gp-grid" data-grid="search"></div>
      <p class="gp-credit">POWERED BY GIPHY</p>
    </div>
    <div data-pane="favorites" hidden><div class="gp-grid" data-grid="favorites"></div></div>
    <div data-pane="recents" hidden><div class="gp-grid" data-grid="recents"></div></div>
    <div data-pane="link" hidden>
      <input class="gp-link" placeholder="Collez un lien GIPHY, Tenor (lien du média), Discord ou Imgur" />
      <p class="gp-hint">Pages GIPHY acceptées telles quelles. Pour Tenor ou Discord, utilisez « Copier l'adresse de l'image ».</p>
    </div>`;

  const q = <T extends HTMLElement>(sel: string) => container.querySelector<T>(sel)!;
  const onError = opts.onError ?? (() => {});
  let favorites: Record<string, Favorite> = {};
  let giphyKey: string | null = null;
  let selected: GifMedia | null = null;
  let tab = "search";
  let results: GifMedia[] = [];
  let loading = false;
  let loaded = false;

  function tile(gif: GifMedia): HTMLElement {
    const el = document.createElement("div");
    el.className = `gp-tile${selected?.url === gif.url ? " sel" : ""}`;
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
      (isFav ? removeFavorite(opts.me, gif.url) : addFavorite(opts.me, gif)).catch(() => onError("Favori non enregistré."));
    });
    el.appendChild(star);
    el.addEventListener("click", () => select(gif));
    return el;
  }

  function fill(name: string, list: GifMedia[], emptyText: string) {
    const grid = q(`[data-grid="${name}"]`);
    grid.replaceChildren();
    if (!list.length) {
      const p = document.createElement("div");
      p.className = "gp-empty";
      p.textContent = emptyText;
      grid.appendChild(p);
      return;
    }
    list.forEach((g) => grid.appendChild(tile(g)));
  }

  function render() {
    if (tab === "search") {
      if (!giphyKey) fill("search", [], "La recherche GIPHY n'est pas encore activée : Kashiro doit ajouter une clé GIPHY dans la Forge. En attendant, utilise l'onglet Lien.");
      else fill("search", results, loading ? "Chargement..." : "Aucun résultat.");
    }
    if (tab === "favorites") fill("favorites", Object.values(favorites).sort((a, b) => b.addedAt - a.addedAt), "Aucun favori : clique sur ☆ sur un GIF pour le garder ici.");
    if (tab === "recents") fill("recents", loadRecents(), "Les GIF que tu utilises apparaîtront ici.");
  }

  async function search(text: string) {
    if (!giphyKey) return render();
    loading = true;
    render();
    try {
      results = await searchGiphy(giphyKey, text);
    } catch (err) {
      results = [];
      onError(err instanceof Error ? err.message : "Recherche impossible.");
    }
    loading = false;
    loaded = true;
    render();
  }

  function show(name: string) {
    tab = name;
    container.querySelectorAll<HTMLButtonElement>(".gp-tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === name));
    container.querySelectorAll<HTMLElement>("[data-pane]").forEach((p) => (p.hidden = p.dataset.pane !== name));
    if (name === "search" && giphyKey && !loaded && !loading) search("");
    if (name === "link") q<HTMLInputElement>(".gp-link").focus();
    render();
  }

  function select(gif: GifMedia) {
    selected = gif;
    render();
    opts.onSelect(gif);
  }

  q(".gp-tabs").addEventListener("click", (e) => {
    const name = (e.target as HTMLElement).dataset.tab;
    if (name) show(name);
  });
  q(".gp-searchbar").addEventListener("submit", (e) => {
    e.preventDefault();
    search(q<HTMLInputElement>(".gp-searchbar input").value);
  });
  q(".gp-link").addEventListener("input", (e) => {
    const value = (e.target as HTMLInputElement).value.trim();
    if (!value) return;
    const gif = normalizeGifLink(value);
    if (gif) select(gif);
    else onError("Lien non pris en charge : GIPHY, Tenor (média), Discord ou Imgur uniquement.");
  });

  watchFavorites(opts.me, (data) => {
    favorites = data;
    render();
  });
  watchGiphyKey((key) => {
    if (key === giphyKey) return;
    giphyKey = key;
    results = [];
    loaded = false;
    if (tab === "search") show("search");
  });

  show("search");
  return { selected: () => selected, refresh: render };
}
