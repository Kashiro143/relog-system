import {
  ref,
  push,
  set,
  get,
  remove,
  update,
  onValue,
  onChildAdded,
  query,
  orderByChild,
  startAt,
  serverTimestamp,
  type Unsubscribe,
} from "firebase/database";
import { db } from "../firebase";

// Envoi de GIF entre membres du Re:log.
// relog/gifs/{cible}/{id}        : GIF envoyés à un membre, lus par son overlay OBS
// relog/overlay/{membre}/gifZone : où et à quelle taille les GIF apparaissent sur son stream
// relog/favorites/{membre}/{id}  : GIF favoris de chacun
// relog/settings/giphyKey        : clé GIPHY (recherche), saisie par Kashiro dans la Forge

export interface GifMedia {
  /** Adresse affichée sur l'overlay (gif, webp, mp4 ou webm). */
  url: string;
  /** Petite version pour les listes, si connue. */
  preview?: string;
  title?: string;
  /** Sticker GIPHY : image transparente, affichée sans cadre ni fond. */
  sticker?: boolean;
}

export type GiphyKind = "gifs" | "stickers";

export interface GifSend extends GifMedia {
  from: string;
  fromName: string;
  color: string;
  caption?: string;
  ts: number;
}

export interface GifZone {
  /** Position sur une grille 3 x 3 : 0 = haut gauche ... 8 = bas droite. */
  cell: number;
  /** Hauteur maximale en pixels sur un overlay 1920 x 1080. */
  height: number;
  /** Durée d'affichage en secondes. */
  seconds: number;
}

export const DEFAULT_ZONE: GifZone = { cell: 2, height: 320, seconds: 6 };

// Seuls ces hébergeurs sont acceptés : un lien quelconque ferait charger à l'OBS
// des autres une adresse inconnue (qui verrait leur adresse IP). Même liste dans
// les règles Firebase.
const ALLOWED_HOST = /^https:\/\/(media[0-9]*\.giphy\.com|i\.giphy\.com|media[0-9]*\.tenor\.com|c\.tenor\.com|cdn\.discordapp\.com|media\.discordapp\.net|i\.imgur\.com)\//;

export function isAllowedMediaUrl(url: string): boolean {
  return url.length <= 600 && ALLOWED_HOST.test(url);
}

export function isVideoUrl(url: string): boolean {
  return /\.(mp4|webm)(\?|#|$)/i.test(url);
}

/**
 * Transforme un lien collé en adresse de média affichable :
 * page GIPHY (giphy.com/gifs/nom-ID), lien d'intégration, ou lien direct.
 * Renvoie null si le lien n'est pas pris en charge.
 */
export function normalizeGifLink(input: string): GifMedia | null {
  const text = input.trim();
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol === "http:") url.protocol = "https:";

  if (/(^|\.)giphy\.com$/.test(url.hostname) && !/^(media[0-9]*|i)\.giphy\.com$/.test(url.hostname)) {
    const parts = url.pathname.split("/").filter(Boolean);
    const slug = parts[0] === "gifs" || parts[0] === "stickers" || parts[0] === "embed" ? parts[parts.length - 1] : "";
    const id = slug?.split("-").pop();
    if (!id) return null;
    if (parts[0] === "stickers") {
      // WebP animé : garde la transparence (le MP4 et le GIF de GIPHY la perdent ou la dégradent).
      return { url: `https://media.giphy.com/media/${id}/giphy.webp`, preview: `https://media.giphy.com/media/${id}/200w.webp`, sticker: true };
    }
    return { url: `https://media.giphy.com/media/${id}/giphy.gif`, preview: `https://media.giphy.com/media/${id}/200w.gif` };
  }

  const href = url.href;
  return isAllowedMediaUrl(href) ? { url: href } : null;
}

// --- Envoi et réception ---

export function sendGif(targets: string[], gif: Omit<GifSend, "ts">) {
  // Heure du serveur : les PC des membres n'ont pas forcément la même horloge.
  const payload = { ...gif, ts: serverTimestamp() } as unknown as GifSend;
  if (!payload.caption) delete payload.caption;
  if (!payload.preview) delete payload.preview;
  if (!payload.title) delete payload.title;
  if (!payload.sticker) delete payload.sticker;
  const updates: Record<string, unknown> = {};
  for (const target of targets) {
    const id = push(ref(db, `relog/gifs/${target}`)).key!;
    updates[`relog/gifs/${target}/${id}`] = payload;
  }
  return update(ref(db), updates);
}

/** Nouveaux GIF reçus (ceux envoyés avant l'ouverture de l'overlay sont ignorés). */
export function watchIncomingGifs(actorId: string, callback: (gif: GifSend) => void): Unsubscribe {
  let stop: Unsubscribe | null = null;
  let cancelled = false;
  // get() refuse les chemins spéciaux ".info" : lecture unique via onValue.
  onValue(ref(db, ".info/serverTimeOffset"), (offset) => {
    if (cancelled) return;
    const since = Date.now() + (Number(offset.val()) || 0) - 2000;
    const q = query(ref(db, `relog/gifs/${actorId}`), orderByChild("ts"), startAt(since));
    stop = onChildAdded(q, (snap) => {
      const gif = snap.val() as GifSend;
      if (gif?.url && isAllowedMediaUrl(gif.url)) callback(gif);
    });
  }, { onlyOnce: true });
  return () => {
    cancelled = true;
    stop?.();
  };
}

/** Supprime les GIF qu'on a envoyés il y a plus de 10 minutes (la base ne grossit pas). */
export async function pruneMySends(targets: string[], myActorId: string) {
  const limit = Date.now() - 10 * 60 * 1000;
  const updates: Record<string, null> = {};
  for (const target of targets) {
    const snap = await get(ref(db, `relog/gifs/${target}`));
    snap.forEach((child) => {
      const gif = child.val() as GifSend;
      if (gif?.from === myActorId && gif.ts < limit) updates[`relog/gifs/${target}/${child.key}`] = null;
    });
  }
  if (Object.keys(updates).length) await update(ref(db), updates);
}

// --- Zone d'affichage sur l'overlay ---

export function watchGifZone(actorId: string, callback: (zone: GifZone) => void): Unsubscribe {
  return onValue(ref(db, `relog/overlay/${actorId}/gifZone`), (snap) => callback({ ...DEFAULT_ZONE, ...snap.val() }));
}

export function setGifZone(actorId: string, patch: Partial<GifZone>) {
  return update(ref(db, `relog/overlay/${actorId}/gifZone`), patch);
}

// --- Favoris ---

export interface Favorite extends GifMedia {
  addedAt: number;
}

export function watchFavorites(actorId: string, callback: (favs: Record<string, Favorite>) => void): Unsubscribe {
  return onValue(ref(db, `relog/favorites/${actorId}`), (snap) => callback(snap.val() ?? {}));
}

/** Clé stable dérivée de l'adresse : un même GIF n'est jamais en double. */
export function favoriteKey(url: string): string {
  let hash = 0;
  for (let i = 0; i < url.length; i++) hash = (hash * 31 + url.charCodeAt(i)) | 0;
  return `f${(hash >>> 0).toString(36)}`;
}

export function addFavorite(actorId: string, gif: GifMedia) {
  const fav: Favorite = { url: gif.url, addedAt: Date.now() };
  if (gif.preview) fav.preview = gif.preview;
  if (gif.title) fav.title = gif.title;
  if (gif.sticker) fav.sticker = true;
  return set(ref(db, `relog/favorites/${actorId}/${favoriteKey(gif.url)}`), fav);
}

export function removeFavorite(actorId: string, url: string) {
  return remove(ref(db, `relog/favorites/${actorId}/${favoriteKey(url)}`));
}

// --- Récents (gardés dans ce navigateur) ---

const RECENTS_KEY = "kos.gif.recents";

export function loadRecents(): GifMedia[] {
  try {
    const list = JSON.parse(localStorage.getItem(RECENTS_KEY) || "[]");
    return Array.isArray(list) ? list.filter((g) => g?.url && isAllowedMediaUrl(g.url)) : [];
  } catch {
    return [];
  }
}

export function pushRecent(gif: GifMedia) {
  const list = [gif, ...loadRecents().filter((g) => g.url !== gif.url)].slice(0, 24);
  try {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(list));
  } catch {
    /* stockage indisponible : pas de récents */
  }
}

// --- Recherche GIPHY ---

export function watchGiphyKey(callback: (key: string | null) => void): Unsubscribe {
  return onValue(ref(db, "relog/settings/giphyKey"), (snap) => callback(snap.val() || null));
}

export function setGiphyKey(key: string) {
  return set(ref(db, "relog/settings/giphyKey"), key.trim() || null);
}

interface GiphyImage {
  url?: string;
  mp4?: string;
  webp?: string;
}
interface GiphyItem {
  id: string;
  title: string;
  images: { original: GiphyImage; fixed_width: GiphyImage; downsized_medium?: GiphyImage };
}

/** Recherche (ou tendances si la requête est vide), filtrée PG-13 pour rester diffusable. */
export async function searchGiphy(apiKey: string, q: string, opts: { offset?: number; kind?: GiphyKind } = {}): Promise<GifMedia[]> {
  const kind = opts.kind ?? "gifs";
  const params = new URLSearchParams({ api_key: apiKey, limit: "24", offset: String(opts.offset ?? 0), rating: "pg-13", bundle: "messaging_non_clips" });
  const endpoint = q.trim() ? "search" : "trending";
  if (q.trim()) {
    params.set("q", q.trim());
    params.set("lang", "fr");
  }
  const res = await fetch(`https://api.giphy.com/v1/${kind}/${endpoint}?${params}`);
  if (!res.ok) throw new Error(res.status === 401 || res.status === 403 ? "Clé GIPHY refusée." : res.status === 429 ? "Limite de recherches GIPHY atteinte, réessaie dans un moment." : `GIPHY a répondu ${res.status}.`);
  const json = (await res.json()) as { data: GiphyItem[] };
  const sticker = kind === "stickers";
  return json.data
    .map((item): GifMedia => ({
      // GIF : MP4, bien plus léger pour l'overlay OBS. Sticker : WebP animé, qui garde la transparence.
      url: (sticker ? item.images.original.webp || item.images.original.url : item.images.original.mp4 || item.images.downsized_medium?.url || item.images.original.url) || "",
      preview: item.images.fixed_width.webp || item.images.fixed_width.url,
      title: item.title,
      ...(sticker ? { sticker: true } : {}),
    }))
    .map((g) => ({ ...g, url: g.url.split("?")[0] }))
    .filter((g) => isAllowedMediaUrl(g.url));
}
