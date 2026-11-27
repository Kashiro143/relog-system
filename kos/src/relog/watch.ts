import { ref, set, update, remove, onValue, serverTimestamp, type Unsubscribe } from "firebase/database";
import { db } from "../firebase";

// Watch-party : une vidéo partagée dans un salon, synchronisée sur l'overlay
// de chaque participant. Sources : YouTube, VOD Twitch, clip Twitch, fichier
// vidéo direct (.mp4 / .webm) sur un hébergeur connu.
// relog/roomContent/{salon}/video   : { source, videoId, title, by, state, position, updatedAt, cell, width, style }
// relog/overlay/{membre}/videoVolume: volume de la vidéo sur SON stream (0..100)
//
// "position" est la position (s) au moment "updatedAt" (heure serveur) : chacun
// en déduit où en est la vidéo, quel que soit le moment où il l'a rejointe.

export type VideoSource = "youtube" | "twitch-vod" | "twitch-clip" | "file";
/** "kos" : cadre d'intrusion futuriste ; "plain" : simple cadre arrondi. */
export type VideoStyle = "kos" | "plain";

export interface RoomVideo {
  /** Absent sur les anciennes vidéos : YouTube. */
  source?: VideoSource;
  /** Identifiant YouTube, numéro de VOD Twitch, slug du clip, ou URL du fichier. */
  videoId: string;
  style?: VideoStyle;
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

/** Tailles proposées (largeur sur un écran 1080p). 1920 = plein écran. */
export const VIDEO_SIZES = [
  { width: 640, label: "S" },
  { width: 960, label: "M" },
  { width: 1280, label: "L" },
  { width: 1600, label: "XL" },
  { width: 1920, label: "Plein écran" },
];
export const DEFAULT_WIDTH = 960;
export const SOURCE_LABELS: Record<VideoSource, string> = {
  youtube: "YouTube",
  "twitch-vod": "VOD Twitch",
  "twitch-clip": "Clip Twitch",
  file: "Fichier vidéo",
};
export const sourceOf = (v: Pick<RoomVideo, "source">): VideoSource => v.source ?? "youtube";
/** Hébergeurs acceptés pour un fichier vidéo direct (protège l'IP des streamers). */
const FILE_HOSTS = /^https:\/\/(video\.twimg\.com|cdn\.discordapp\.com|media\.discordapp\.net|i\.imgur\.com)\/[^\s"'<>]+$/;
export const isAllowedVideoFile = (url: string) => FILE_HOSTS.test(url) && url.length <= 500;
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

export type ParsedLink = { source: VideoSource; id: string; start: number } | { error: string };

/** Reconnaît un lien YouTube, Twitch (VOD ou clip) ou un fichier vidéo direct. */
export function parseVideoLink(input: string): ParsedLink {
  const text = input.trim();
  if (!text) return { error: "Colle un lien." };
  const yt = parseYouTubeId(text);
  if (yt) return { source: "youtube", id: yt, start: parseStartTime(text) };
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { error: "Ce n'est pas un lien." };
  }
  const host = url.hostname.replace(/^www\.|^m\./, "");
  if (host === "twitch.tv" || host === "clips.twitch.tv") {
    const vod = url.pathname.match(/^\/videos\/(\d{5,12})/);
    if (vod) return { source: "twitch-vod", id: vod[1], start: parseStartTime(text) };
    const clip = host === "clips.twitch.tv" ? url.pathname.match(/^\/([A-Za-z0-9_-]{3,100})/) : url.pathname.match(/^\/[^/]+\/clip\/([A-Za-z0-9_-]{3,100})/);
    if (clip && clip[1] !== "embed") return { source: "twitch-clip", id: clip[1], start: 0 };
    if (host === "clips.twitch.tv" && url.searchParams.get("clip")) return { source: "twitch-clip", id: url.searchParams.get("clip")!, start: 0 };
    return { error: "Lien Twitch non reconnu : colle le lien d'une VOD (twitch.tv/videos/…) ou d'un clip." };
  }
  if (host === "x.com" || host === "twitter.com") {
    return { error: "X/Twitter n'autorise pas la lecture intégrée de ses vidéos : colle plutôt le lien direct du fichier (video.twimg.com/…/.mp4)." };
  }
  if (isAllowedVideoFile(url.href)) return { source: "file", id: url.href, start: 0 };
  if (/\.(mp4|webm|mov)(\?|$)/i.test(url.pathname + url.search)) {
    return { error: "Fichier vidéo hébergé sur un site non accepté (acceptés : video.twimg.com, Discord, Imgur)." };
  }
  return { error: "Lien non reconnu : YouTube, VOD ou clip Twitch, ou fichier vidéo direct." };
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
    callback(v && typeof v.videoId === "string" && v.by ? (v as RoomVideo) : null);
  });
}

export function startVideo(
  room: string,
  video: { source: VideoSource; videoId: string; title?: string; by: string; position?: number; cell: number; width: number; style: VideoStyle },
) {
  const record: Record<string, unknown> = {
    source: video.source,
    style: video.style,
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

export function setVideoLayout(room: string, patch: Partial<Pick<RoomVideo, "cell" | "width" | "style">>) {
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
