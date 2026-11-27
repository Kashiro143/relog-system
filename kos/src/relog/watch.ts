import { ref, set, update, remove, onValue, serverTimestamp, type Unsubscribe } from "firebase/database";
import { db } from "../firebase";

// Watch-party : une vidéo YouTube partagée dans un salon, synchronisée sur
// l'overlay de chaque participant.
// relog/roomContent/{salon}/video   : { videoId, title, by, state, position, updatedAt, cell, width }
// relog/overlay/{membre}/videoVolume: volume de la vidéo sur SON stream (0..100)
//
// "position" est la position (s) au moment "updatedAt" (heure serveur) : chacun
// en déduit où en est la vidéo, quel que soit le moment où il l'a rejointe.

export interface RoomVideo {
  videoId: string;
  title?: string;
  by: string;
  state: "playing" | "paused";
  position: number;
  updatedAt: number;
  /** Grille 3 x 3 de l'overlay : 0 = haut gauche ... 8 = bas droite. */
  cell: number;
  /** Largeur en pixels sur un écran 1080p. */
  width: number;
}

export const VIDEO_WIDTHS = [480, 720, 1100];
export const DEFAULT_VOLUME = 50;

/** Identifiant YouTube depuis un lien (watch, youtu.be, shorts, embed, live) ou l'identifiant seul. */
export function parseYouTubeId(input: string): string | null {
  const text = input.trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(text)) return text;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\.|^m\./, "");
  let id: string | null = null;
  if (host === "youtu.be") id = url.pathname.slice(1).split("/")[0];
  else if (host === "youtube.com" || host === "music.youtube.com" || host === "youtube-nocookie.com") {
    id = url.searchParams.get("v");
    const m = url.pathname.match(/^\/(shorts|embed|live|v)\/([A-Za-z0-9_-]{11})/);
    if (!id && m) id = m[2];
  }
  return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
}

/** Position de départ demandée par le lien (?t=90, ?t=1m30s, &start=90). */
export function parseStartTime(input: string): number {
  try {
    const url = new URL(input.trim());
    const t = url.searchParams.get("t") || url.searchParams.get("start");
    if (!t) return 0;
    if (/^\d+$/.test(t)) return Number(t);
    const m = t.match(/(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?/);
    return m ? Number(m[1] || 0) * 3600 + Number(m[2] || 0) * 60 + Number(m[3] || 0) : 0;
  } catch {
    return 0;
  }
}

/** Où la vidéo doit en être maintenant (secondes). */
export function expectedPosition(v: RoomVideo, serverNow: number): number {
  if (v.state !== "playing") return v.position;
  return v.position + Math.max(0, serverNow - v.updatedAt) / 1000;
}

const videoRef = (room: string) => ref(db, `relog/roomContent/${room}/video`);

export function watchVideo(room: string, callback: (video: RoomVideo | null) => void): Unsubscribe {
  return onValue(videoRef(room), (snap) => {
    const v = snap.val();
    callback(v && typeof v.videoId === "string" ? (v as RoomVideo) : null);
  });
}

export function startVideo(room: string, video: { videoId: string; title?: string; by: string; position?: number; cell: number; width: number }) {
  const record: Record<string, unknown> = {
    videoId: video.videoId,
    by: video.by,
    state: "playing",
    position: Math.max(0, video.position ?? 0),
    updatedAt: serverTimestamp(),
    cell: video.cell,
    width: video.width,
  };
  if (video.title) record.title = video.title.slice(0, 200);
  return set(videoRef(room), record);
}

/** Lecture, pause ou déplacement dans la vidéo, pour tout le salon. */
export function controlVideo(room: string, state: RoomVideo["state"], position: number) {
  return update(videoRef(room), { state, position: Math.max(0, position), updatedAt: serverTimestamp() });
}

export function setVideoLayout(room: string, patch: Partial<Pick<RoomVideo, "cell" | "width">>) {
  return update(videoRef(room), patch);
}

export function setVideoTitle(room: string, title: string) {
  return update(videoRef(room), { title: title.slice(0, 200) });
}

export function stopVideo(room: string) {
  return remove(videoRef(room));
}

export function watchVolume(actorId: string, callback: (volume: number) => void): Unsubscribe {
  return onValue(ref(db, `relog/overlay/${actorId}/videoVolume`), (snap) => {
    const v = snap.val();
    callback(typeof v === "number" ? v : DEFAULT_VOLUME);
  });
}

export function setVolume(actorId: string, volume: number) {
  return set(ref(db, `relog/overlay/${actorId}/videoVolume`), Math.round(Math.min(100, Math.max(0, volume))));
}
