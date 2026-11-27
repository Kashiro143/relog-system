import {
  ref,
  set,
  update,
  onValue,
  onChildAdded,
  onChildChanged,
  onChildRemoved,
  push,
  serverTimestamp,
  type DatabaseReference,
  type Unsubscribe,
} from "firebase/database";
import { db } from "../firebase";
import { serverNow } from "./serverTime";

// Salons du Re:log : les streamers rejoignent un salon, et tout ce qui s'y fait
// (dessins, textes, GIF posés, pointeur laser) apparaît sur l'overlay de chacun.
//
// relog/rooms/{salon}                       : { name, by, createdAt }  (liste)
// relog/roomContent/{salon}/strokes/{id}    : traits
// relog/roomContent/{salon}/items/{id}      : textes et GIF posés
// relog/roomContent/{salon}/cursors/{membre}: pointeur laser (non conservé)
// relog/overlay/{membre}/room               : salon rejoint (un seul à la fois)
//
// Coordonnées 0..10000 sur les deux axes : indépendantes de la résolution.

export const SCALE = 10000;
/** Au-delà, le trait en cours est découpé (limite d'écriture par trait). */
export const MAX_POINTS_CHARS = 18000;

export interface RoomMeta {
  name: string;
  by: string;
  createdAt: number;
}

export interface Stroke {
  id: string;
  by: string;
  color: string;
  /** Épaisseur en pixels sur un écran 1080p. */
  width: number;
  /** x0, y0, x1, y1... entiers 0..10000 */
  points: number[];
  /** Secondes de visibilité après la fin ; 0 = permanent. */
  fade: number;
  end?: number;
  done: boolean;
}

export interface Item {
  id: string;
  type: "text" | "gif";
  by: string;
  color: string;
  /** Centre de l'élément, 0..10000 */
  x: number;
  y: number;
  /** Texte : taille de police ; GIF : hauteur — en pixels sur un écran 1080p. */
  size: number;
  text?: string;
  url?: string;
  /** GIF transparent (sticker GIPHY) : sans cadre. */
  sticker?: boolean;
  fade: number;
  end: number;
}

export interface Cursor {
  x: number;
  y: number;
  ts: number;
  on: boolean;
  color: string;
  name: string;
}

const encodePoints = (points: number[]) => points.join(",");
const decodePoints = (pts: string) => (pts ? pts.split(",").map(Number).filter((n) => Number.isFinite(n)) : []);
export const pointsLength = (points: number[]) => encodePoints(points).length;

/** Opacité à l'instant donné : visible "fade" secondes après la fin, puis disparaît en 1 s. */
export function fadeAlpha(fade: number, end: number | undefined, done: boolean, now: number): number {
  if (!fade || !done || !end) return 1;
  const left = end + fade * 1000 - now;
  return left <= 0 ? 0 : Math.min(1, left / 1000);
}

export const isExpired = (fade: number, end: number | undefined, done: boolean, now: number) =>
  done && fade > 0 && !!end && now > end + fade * 1000 + 1500;

const content = (room: string, path = "") => ref(db, `relog/roomContent/${room}${path ? "/" + path : ""}`);

// --- Liste des salons, rejoindre, quitter ---

export function watchRooms(callback: (rooms: Record<string, RoomMeta>) => void): Unsubscribe {
  return onValue(ref(db, "relog/rooms"), (snap) => callback(snap.val() ?? {}));
}

export async function createRoom(name: string, by: string): Promise<string> {
  const id = push(ref(db, "relog/rooms")).key!;
  await set(ref(db, `relog/rooms/${id}`), { name: name.trim().slice(0, 40) || "Salon", by, createdAt: serverTimestamp() });
  return id;
}

export function deleteRoom(id: string) {
  return update(ref(db), { [`relog/rooms/${id}`]: null, [`relog/roomContent/${id}`]: null });
}

export function watchMyRoom(actorId: string, callback: (roomId: string | null) => void): Unsubscribe {
  return onValue(ref(db, `relog/overlay/${actorId}/room`), (snap) => callback(snap.val() || null));
}

export function joinRoom(actorId: string, roomId: string) {
  return set(ref(db, `relog/overlay/${actorId}/room`), roomId);
}

export function leaveRoom(actorId: string, roomId: string | null) {
  const updates: Record<string, null> = { [`relog/overlay/${actorId}/room`]: null };
  if (roomId) updates[`relog/roomContent/${roomId}/cursors/${actorId}`] = null;
  return update(ref(db), updates);
}

// --- Lecture en direct du contenu d'un salon ---

function watchMap<T>(base: DatabaseReference, parse: (id: string, raw: any) => T | null, onChange: (map: Map<string, T>) => void): Unsubscribe {
  const map = new Map<string, T>();
  const put = (key: string | null, raw: unknown) => {
    if (!key) return;
    const value = parse(key, raw);
    if (value) map.set(key, value);
    else map.delete(key);
    onChange(map);
  };
  const stops = [
    onChildAdded(base, (s) => put(s.key, s.val())),
    onChildChanged(base, (s) => put(s.key, s.val())),
    onChildRemoved(base, (s) => {
      if (s.key) map.delete(s.key);
      onChange(map);
    }),
  ];
  onChange(map);
  return () => stops.forEach((stop) => stop());
}

export function watchStrokes(room: string, onChange: (strokes: Map<string, Stroke>) => void): Unsubscribe {
  return watchMap(content(room, "strokes"), (id, r) =>
    r && typeof r.pts === "string"
      ? { id, by: r.by, color: r.color, width: r.width, points: decodePoints(r.pts), fade: r.fade || 0, end: r.end, done: !!r.done }
      : null,
  onChange);
}

export function watchItems(room: string, onChange: (items: Map<string, Item>) => void): Unsubscribe {
  return watchMap(content(room, "items"), (id, r) => (r && (r.type === "text" || r.type === "gif") ? { id, ...r, fade: r.fade || 0 } : null), onChange);
}

export function watchCursors(room: string, callback: (cursors: Record<string, Cursor>) => void): Unsubscribe {
  return onValue(content(room, "cursors"), (snap) => callback(snap.val() ?? {}));
}

// --- Écriture ---

export const newStrokeId = (room: string) => push(content(room, "strokes")).key!;

export function startStroke(room: string, id: string, s: Pick<Stroke, "by" | "color" | "width" | "points" | "fade">) {
  return set(content(room, `strokes/${id}`), { by: s.by, color: s.color, width: s.width, pts: encodePoints(s.points), fade: s.fade, ts: serverTimestamp(), done: false });
}

export function updateStroke(room: string, id: string, points: number[]) {
  return update(content(room, `strokes/${id}`), { pts: encodePoints(points) });
}

export function finishStroke(room: string, id: string, points: number[]) {
  return update(content(room, `strokes/${id}`), { pts: encodePoints(points), done: true, end: serverNow() });
}

export async function addItem(room: string, item: Omit<Item, "id" | "end">): Promise<string> {
  const id = push(content(room, "items")).key!;
  const record: Record<string, unknown> = { ...item, x: Math.round(item.x), y: Math.round(item.y), ts: serverTimestamp(), end: serverNow() };
  if (item.type === "text") {
    delete record.url;
    delete record.sticker;
  } else delete record.text;
  if (!record.sticker) delete record.sticker;
  await set(content(room, `items/${id}`), record);
  return id;
}

export function moveItem(room: string, id: string, x: number, y: number) {
  return update(content(room, `items/${id}`), { x: Math.round(x), y: Math.round(y) });
}

/** Supprime des traits et éléments (chemins "strokes/id" ou "items/id"). */
export function removeContent(room: string, paths: string[]) {
  if (!paths.length) return Promise.resolve();
  return update(ref(db), Object.fromEntries(paths.map((p) => [`relog/roomContent/${room}/${p}`, null])));
}

export function setCursor(room: string, actorId: string, cursor: Omit<Cursor, "ts">) {
  return set(content(room, `cursors/${actorId}`), { ...cursor, ts: serverTimestamp() });
}
