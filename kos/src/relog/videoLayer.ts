import { expectedPosition, sourceOf, SOURCE_LABELS, isAllowedVideoFile, type RoomVideo } from "./watch";
import { serverNow } from "./serverTime";

// Lecteur de la watch-party, synchronisé sur l'état partagé du salon. Utilisé
// par l'overlay OBS (avec le son, au volume choisi par le membre) et par les
// pages Watch-party / Salons (aperçu, muet par défaut).
//
// Chaque source a son "pilote" : YouTube (IFrame API), VOD Twitch (Embed
// API), clip Twitch (simple iframe : ni pause ni synchro) et fichier vidéo.

/** Écart toléré avant de recaler la vidéo (s). */
const DRIFT_S = 1.5;

// ---------- Chargement des API ----------

interface YTPlayer {
  loadVideoById(opts: { videoId: string; startSeconds?: number }): void;
  cueVideoById(opts: { videoId: string; startSeconds?: number }): void;
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  getVideoData?(): { title?: string };
  setVolume(v: number): void;
  mute(): void;
  unMute(): void;
  destroy(): void;
}
interface TwitchPlayer {
  play(): void;
  pause(): void;
  seek(s: number): void;
  getCurrentTime(): number;
  getDuration(): number;
  isPaused(): boolean;
  getEnded(): boolean;
  setVolume(v: number): void;
  setMuted(m: boolean): void;
  setVideo(id: string, t: number): void;
  addEventListener(ev: string, cb: () => void): void;
}
declare global {
  interface Window {
    YT?: { Player: new (el: HTMLElement, opts: unknown) => YTPlayer };
    onYouTubeIframeAPIReady?: () => void;
    Twitch?: { Player: (new (id: string, opts: unknown) => TwitchPlayer) & { READY: string; PLAYING: string; PAUSE: string; ENDED: string } };
  }
}

const scripts = new Map<string, Promise<void>>();
function loadScript(src: string, ready: () => boolean, hook?: (done: () => void) => void): Promise<void> {
  if (ready()) return Promise.resolve();
  if (!scripts.has(src)) {
    scripts.set(
      src,
      new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = src;
        if (hook) hook(resolve);
        else s.onload = () => resolve();
        s.onerror = () => reject(new Error(`script ${src}`));
        document.head.appendChild(s);
      }),
    );
  }
  return scripts.get(src)!;
}
const loadYouTube = () =>
  loadScript("https://www.youtube.com/iframe_api", () => !!window.YT?.Player, (done) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      done();
    };
  });
const loadTwitch = () => loadScript("https://player.twitch.tv/js/embed/v1.js", () => !!window.Twitch?.Player);

// ---------- Pilotes ----------

interface Driver {
  /** La source sait se mettre en pause et se positionner (sinon : clip lu du début). */
  readonly seekable: boolean;
  load(id: string, start: number, playing: boolean): void;
  play(): void;
  pause(): void;
  seek(s: number): void;
  current(): number;
  duration(): number;
  /** "playing" | "paused" | "buffering" | "ended" */
  status(): string;
  audio(muted: boolean, volume: number): void;
  title?(): string | undefined;
  destroy(): void;
}

let uid = 0;

function youtubeDriver(slot: HTMLElement, onReady: () => void, onError: (msg: string) => void): Driver {
  let p: YTPlayer | null = null;
  let ready = false;
  loadYouTube().then(() => {
    p = new window.YT!.Player(slot, {
      width: "100%",
      height: "100%",
      playerVars: { controls: 0, disablekb: 1, modestbranding: 1, rel: 0, playsinline: 1, iv_load_policy: 3, fs: 0, origin: location.origin },
      events: {
        onReady: () => {
          ready = true;
          onReady();
        },
        onError: (e: { data: number }) =>
          onError(e.data === 101 || e.data === 150 ? "Cette vidéo YouTube n'autorise pas la lecture intégrée." : "Vidéo YouTube indisponible."),
      },
    });
  });
  const ok = () => (ready && p ? p : null);
  return {
    seekable: true,
    load: (id, start, playing) => (playing ? ok()?.loadVideoById({ videoId: id, startSeconds: start }) : ok()?.cueVideoById({ videoId: id, startSeconds: start })),
    play: () => ok()?.playVideo(),
    pause: () => ok()?.pauseVideo(),
    seek: (s) => ok()?.seekTo(s, true),
    current: () => ok()?.getCurrentTime() ?? 0,
    duration: () => ok()?.getDuration() ?? 0,
    status: () => {
      const st = ok()?.getPlayerState();
      return st === 1 ? "playing" : st === 3 ? "buffering" : st === 0 ? "ended" : "paused";
    },
    audio: (muted, volume) => {
      const pl = ok();
      if (!pl) return;
      if (muted) pl.mute();
      else {
        pl.unMute();
        pl.setVolume(volume);
      }
    },
    title: () => ok()?.getVideoData?.()?.title,
    destroy: () => p?.destroy(),
  };
}

function twitchVodDriver(slot: HTMLElement, onReady: () => void, onError: (msg: string) => void): Driver {
  let p: TwitchPlayer | null = null;
  let ready = false;
  let booting = false;
  let loaded: string | null = null;
  let started = false;
  let wanted: { muted: boolean; volume: number } | null = null;
  const applyWanted = () => {
    if (!p || !wanted) return;
    p.setMuted(wanted.muted);
    if (!wanted.muted) p.setVolume(wanted.volume / 100);
  };
  slot.id = `kos-twitch-${++uid}`;
  // Le lecteur Twitch se crée avec sa première vidéo : on se déclare prêt tout
  // de suite pour recevoir ce premier "load", puis à nouveau quand Twitch l'est.
  setTimeout(onReady, 0);
  const boot = (id: string, start: number, playing: boolean) => {
    booting = true;
    loadTwitch()
      .then(() => {
        const T = window.Twitch!.Player;
        // Pas d'autoplay ni de "time" à la création : dans OBS, Twitch reste alors
        // bloqué sur son bouton lecture. On démarre nous-mêmes une fois prêt
        // (seek + play), comme pour un changement de vidéo, ce qui fonctionne.
        p = new T(slot.id, {
          width: "100%",
          height: "100%",
          video: `v${id}`,
          parent: [location.hostname],
          autoplay: false,
          muted: true,
          controls: false,
        });
        loaded = id;
        const bootAt = Date.now();
        // Le son n'est appliqué qu'une fois l'image partie : activé avant, Twitch
        // bloque la lecture sur son affiche (bouton lecture) dans OBS.
        p.addEventListener(T.PLAYING, () => {
          if (started) return;
          started = true;
          setTimeout(() => applyWanted(), 800);
        });
        p.addEventListener(T.READY, () => {
          if (ready) return;
          ready = true;
          const pl = p!;
          pl.setVideo(`v${id}`, playing ? start + (Date.now() - bootAt) / 1000 : start);
          if (playing) pl.play();
          else pl.pause();
          onReady();
        });
      })
      .catch(() => onError("Lecteur Twitch indisponible."));
  };
  const ok = () => (ready && p ? p : null);
  return {
    seekable: true,
    load: (id, start, playing) => {
      if (!p) {
        if (!booting) boot(id, start, playing);
        return;
      }
      if (loaded !== id) {
        loaded = id;
        p.setVideo(`v${id}`, start);
      } else p.seek(start);
      if (playing) p.play();
      else p.pause();
    },
    play: () => ok()?.play(),
    pause: () => ok()?.pause(),
    seek: (s) => ok()?.seek(s),
    current: () => ok()?.getCurrentTime() ?? 0,
    duration: () => ok()?.getDuration() ?? 0,
    status: () => {
      const pl = ok();
      if (!pl) return "buffering";
      return pl.getEnded() ? "ended" : pl.isPaused() ? "paused" : "playing";
    },
    audio: (muted, volume) => {
      wanted = { muted, volume };
      if (started) applyWanted();
    },
    destroy: () => slot.replaceChildren(),
  };
}

/** Clip Twitch : simple iframe sans API. Relancé du début à chaque "lecture". */
function twitchClipDriver(slot: HTMLElement, onReady: () => void): Driver {
  let iframe: HTMLIFrameElement | null = null;
  let clip: string | null = null;
  let muted = true;
  let playing = false;
  let startedAt = 0;
  const render = () => {
    iframe?.remove();
    iframe = null;
    if (!clip || !playing) return;
    iframe = document.createElement("iframe");
    iframe.allow = "autoplay; encrypted-media";
    iframe.src = `https://clips.twitch.tv/embed?clip=${encodeURIComponent(clip)}&parent=${encodeURIComponent(location.hostname)}&autoplay=true&muted=${muted}`;
    slot.appendChild(iframe);
    startedAt = Date.now();
  };
  setTimeout(onReady, 0);
  return {
    seekable: false,
    load: (id, _start, play) => {
      clip = id;
      playing = play;
      render();
    },
    play: () => {
      playing = true;
      render();
    },
    pause: () => {
      playing = false;
      render();
    },
    seek: () => {},
    current: () => (playing ? (Date.now() - startedAt) / 1000 : 0),
    duration: () => 0,
    status: () => (playing ? "playing" : "paused"),
    audio: (m, volume) => {
      const next = m || volume === 0;
      if (next === muted) return;
      muted = next;
      render();
    },
    destroy: () => iframe?.remove(),
  };
}

function fileDriver(slot: HTMLElement, onReady: () => void, onError: (msg: string) => void): Driver {
  const v = document.createElement("video");
  v.playsInline = true;
  v.preload = "auto";
  v.muted = true;
  v.addEventListener("error", () => onError("Fichier vidéo illisible (lien expiré ?)."));
  slot.appendChild(v);
  setTimeout(onReady, 0);
  return {
    seekable: true,
    load: (url, start, playing) => {
      if (!isAllowedVideoFile(url)) return onError("Hébergeur de vidéo non accepté.");
      if (v.src !== url) v.src = url;
      const go = () => {
        v.currentTime = start;
        if (playing) v.play().catch(() => {});
      };
      if (v.readyState >= 1) go();
      else v.addEventListener("loadedmetadata", go, { once: true });
    },
    play: () => void v.play().catch(() => {}),
    pause: () => v.pause(),
    seek: (s) => (v.currentTime = s),
    current: () => v.currentTime,
    duration: () => (Number.isFinite(v.duration) ? v.duration : 0),
    status: () => (v.ended ? "ended" : v.paused ? "paused" : v.readyState < 3 ? "buffering" : "playing"),
    audio: (muted, volume) => {
      v.muted = muted;
      v.volume = volume / 100;
    },
    destroy: () => {
      v.pause();
      v.removeAttribute("src");
      v.load();
    },
  };
}

// ---------- Cadre ----------

const STYLE = `
.kos-video { position: absolute; aspect-ratio: 16 / 9; transition: left 0.35s, top 0.35s, width 0.35s; --b: calc(var(--k, 1) * 2px); --cut: calc(var(--k, 1) * 22px); }
.kos-video .screen { position: absolute; inset: 0; background: #000; overflow: hidden; }
.kos-video .slot, .kos-video .slot > *, .kos-video iframe, .kos-video video { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; pointer-events: none; object-fit: contain; background: #000; }
.kos-video .err { position: absolute; inset: 0; display: grid; place-items: center; color: #fff; font: 600 calc(var(--k, 1) * 22px) "Segoe UI", sans-serif; text-align: center; padding: 10%; background: #111; z-index: 5; }

/* Sobre */
.kos-video.plain .screen { border-radius: calc(var(--k, 1) * 10px); box-shadow: 0 0 0 var(--b) var(--c, #00d4ff), 0 0 calc(var(--k, 1) * 26px) rgba(0,0,0,0.6); }
.kos-video.plain .hud, .kos-video.plain .corner, .kos-video.plain .fx, .kos-video.plain .edge { display: none; }

/* Intrusion K-OS */
.kos-video.kos .edge { position: absolute; inset: calc(var(--b) * -1); background: linear-gradient(135deg, var(--c, #00d4ff), color-mix(in srgb, var(--c, #00d4ff) 35%, #000) 45%, var(--c, #00d4ff));
  clip-path: polygon(var(--cut) 0, 100% 0, 100% calc(100% - var(--cut)), calc(100% - var(--cut)) 100%, 0 100%, 0 var(--cut));
  filter: drop-shadow(0 0 calc(var(--k, 1) * 14px) var(--c, #00d4ff)); }
.kos-video.kos .screen { clip-path: polygon(var(--cut) 0, 100% 0, 100% calc(100% - var(--cut)), calc(100% - var(--cut)) 100%, 0 100%, 0 var(--cut)); }
.kos-video.kos { filter: drop-shadow(0 0 calc(var(--k, 1) * 18px) color-mix(in srgb, var(--c, #00d4ff) 45%, transparent)); }
.kos-video .corner { position: absolute; width: calc(var(--k, 1) * 34px); height: calc(var(--k, 1) * 34px); border: solid var(--c, #00d4ff); border-width: 0; opacity: 0.9; animation: kosv-pulse 2.4s ease-in-out infinite; }
.kos-video .corner.tl { top: calc(var(--k, 1) * -12px); left: calc(var(--k, 1) * -12px); border-top-width: var(--b); border-left-width: var(--b); }
.kos-video .corner.tr { top: calc(var(--k, 1) * -12px); right: calc(var(--k, 1) * -12px); border-top-width: var(--b); border-right-width: var(--b); }
.kos-video .corner.bl { bottom: calc(var(--k, 1) * -12px); left: calc(var(--k, 1) * -12px); border-bottom-width: var(--b); border-left-width: var(--b); }
.kos-video .corner.br { bottom: calc(var(--k, 1) * -12px); right: calc(var(--k, 1) * -12px); border-bottom-width: var(--b); border-right-width: var(--b); }
.kos-video.full .corner { display: none; }
.kos-video.full { --cut: 0px; }
.kos-video .fx { position: absolute; inset: 0; pointer-events: none; z-index: 3;
  background: repeating-linear-gradient(0deg, rgba(0,0,0,0.18) 0 calc(var(--k, 1) * 1px), transparent calc(var(--k, 1) * 1px) calc(var(--k, 1) * 3px)),
              radial-gradient(ellipse at center, transparent 62%, rgba(0,0,0,0.45)); mix-blend-mode: multiply; }
.kos-video .fx::after { content: ""; position: absolute; left: 0; right: 0; height: 18%; top: -18%; background: linear-gradient(180deg, transparent, color-mix(in srgb, var(--c, #00d4ff) 10%, transparent), transparent); animation: kosv-sweep 7s linear infinite; }
.kos-video .hud { position: absolute; left: 0; right: 0; z-index: 6; display: flex; align-items: center; gap: calc(var(--k, 1) * 12px); padding: calc(var(--k, 1) * 10px) calc(var(--k, 1) * 18px) calc(var(--k, 1) * 10px) calc(var(--cut) + var(--k, 1) * 8px);
  font: 700 calc(var(--k, 1) * 15px) "JetBrains Mono", Consolas, monospace; letter-spacing: calc(var(--k, 1) * 1.5px); color: #fff; text-shadow: 0 0 calc(var(--k, 1) * 6px) #000; transition: opacity 0.6s; }
.kos-video .hud.top { top: 0; background: linear-gradient(180deg, rgba(0,0,0,0.85), transparent); }
.kos-video .hud.bottom { bottom: 0; padding-left: calc(var(--k, 1) * 18px); padding-right: calc(var(--cut) + var(--k, 1) * 8px); background: linear-gradient(0deg, rgba(0,0,0,0.85), transparent); }
.kos-video .hud .tag { color: var(--c, #00d4ff); white-space: nowrap; }
.kos-video .hud .tag::before { content: ""; display: inline-block; width: calc(var(--k, 1) * 9px); height: calc(var(--k, 1) * 9px); border-radius: 50%; background: #ff3355; box-shadow: 0 0 calc(var(--k, 1) * 8px) #ff3355; margin-right: calc(var(--k, 1) * 8px); vertical-align: middle; animation: kosv-blink 1s steps(2) infinite; }
.kos-video .hud .ttl { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
.kos-video .hud .by { white-space: nowrap; color: var(--c, #00d4ff); }
.kos-video .hud .bar { flex: 1; height: calc(var(--k, 1) * 3px); background: rgba(255,255,255,0.18); position: relative; }
.kos-video .hud .bar i { position: absolute; left: 0; top: 0; bottom: 0; width: 0; background: var(--c, #00d4ff); box-shadow: 0 0 calc(var(--k, 1) * 8px) var(--c, #00d4ff); }
.kos-video .hud .tc { white-space: nowrap; font-variant-numeric: tabular-nums; }
.kos-video.full.calm .hud { opacity: 0; }
/* Hors plein écran : bandeaux accrochés au cadre, à l'extérieur (YouTube affiche parfois son titre dans l'image). */
.kos-video.kos:not(.full) .hud.top { top: auto; bottom: calc(100% + var(--b) + var(--k, 1) * 8px); left: calc(var(--cut) * 0.5); right: auto; max-width: calc(100% - var(--cut)); padding: calc(var(--k, 1) * 6px) calc(var(--k, 1) * 26px) calc(var(--k, 1) * 6px) calc(var(--k, 1) * 12px);
  background: color-mix(in srgb, var(--c, #00d4ff) 16%, rgba(0,0,0,0.88)); border-left: calc(var(--k, 1) * 4px) solid var(--c, #00d4ff);
  clip-path: polygon(0 0, calc(100% - var(--k, 1) * 16px) 0, 100% 100%, 0 100%); }
.kos-video.kos:not(.full) .hud.bottom { bottom: auto; top: calc(100% + var(--b) + var(--k, 1) * 8px); padding: 0 calc(var(--cut) * 0.5); background: none; font-size: calc(var(--k, 1) * 13px); }
.kos-video .pause { position: absolute; inset: 0; z-index: 4; display: none; place-items: center; font: 800 calc(var(--k, 1) * 34px) "JetBrains Mono", Consolas, monospace; letter-spacing: calc(var(--k, 1) * 6px); color: var(--c, #00d4ff); background: rgba(0,0,0,0.9); backdrop-filter: blur(calc(var(--k, 1) * 8px)); text-shadow: 0 0 calc(var(--k, 1) * 14px) var(--c, #00d4ff); }
/* La pause masque aussi l'interface que YouTube affiche sur une vidéo arrêtée. */
.kos-video.paused .pause, .kos-video.ended .pause, .kos-video.resuming .pause { display: grid; }
/* Fichier vidéo en pause : l'image figée reste visible (pour dessiner dessus), simple badge.
   YouTube et Twitch gardent l'écran opaque : en pause, ils imposent leur interface. */
.kos-video.src-file.paused:not(.ended):not(.resuming) .pause { inset: auto; top: calc(var(--k, 1) * 14px); right: calc(var(--k, 1) * 14px); padding: calc(var(--k, 1) * 6px) calc(var(--k, 1) * 12px); font-size: calc(var(--k, 1) * 16px); letter-spacing: calc(var(--k, 1) * 3px); background: rgba(0,0,0,0.72); backdrop-filter: none; border: 1px solid var(--c, #00d4ff); border-radius: calc(var(--k, 1) * 4px); }
/* À la reprise, YouTube réaffiche son titre quelques secondes : on le cache sous un fondu. */
.kos-video.resuming .pause { animation: kosv-fade 5.5s ease-in forwards; }
@keyframes kosv-fade { 0%, 80% { opacity: 1; } 100% { opacity: 0; } }
.kos-video.plain .pause { color: #fff; text-shadow: none; font-size: calc(var(--k, 1) * 26px); }
.kos-video .boot { position: absolute; inset: 0; z-index: 4; display: grid; place-items: center; background: #000; color: var(--c, #00d4ff); font: 700 calc(var(--k, 1) * 22px) "JetBrains Mono", Consolas, monospace; letter-spacing: calc(var(--k, 1) * 4px); transition: opacity 0.5s; }
.kos-video .boot span { animation: kosv-blink 0.8s steps(2) infinite; }
.kos-video.live .boot { opacity: 0; pointer-events: none; }
.kos-video.plain .boot { display: none; }
.kos-video.kos.enter { animation: kosv-in 0.75s cubic-bezier(.2,.9,.3,1) both; }
.kos-video.kos.leave { animation: kosv-out 0.45s ease-in both; }
.kos-video.kos.glitch .screen { animation: kosv-glitch 0.28s steps(3) 1; }
@keyframes kosv-in {
  0% { transform: scale(0.02, 0.004); opacity: 0; filter: brightness(3); }
  25% { transform: scale(1, 0.004); opacity: 1; }
  45% { transform: scale(1, 0.004); }
  70% { transform: scale(1.02, 1.04) translateX(calc(var(--k, 1) * -6px)); filter: brightness(1.6) hue-rotate(40deg); }
  82% { transform: scale(1, 1) translateX(calc(var(--k, 1) * 5px)); filter: none; }
  100% { transform: none; }
}
@keyframes kosv-out {
  0% { transform: none; opacity: 1; }
  40% { transform: scale(1, 0.004); filter: brightness(3); }
  100% { transform: scale(0, 0.004); opacity: 0; }
}
@keyframes kosv-glitch {
  0% { transform: translate(calc(var(--k, 1) * -8px), 0); filter: hue-rotate(90deg) saturate(2); }
  50% { transform: translate(calc(var(--k, 1) * 6px), calc(var(--k, 1) * 2px)); clip-path: inset(10% 0 40% 0); }
  100% { transform: none; filter: none; }
}
@keyframes kosv-pulse { 50% { opacity: 0.35; } }
@keyframes kosv-blink { 50% { opacity: 0.2; } }
@keyframes kosv-sweep { to { top: 118%; } }
`;
function injectStyleOnce() {
  if (document.getElementById("kos-video-style")) return;
  const style = document.createElement("style");
  style.id = "kos-video-style";
  style.textContent = STYLE;
  document.head.appendChild(style);
}

const fmt = (sec: number) => {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}` : `${m}:${String(r).padStart(2, "0")}`;
};

// ---------- Couche vidéo ----------

export interface VideoMeta {
  color?: string;
  name?: string;
}

export interface VideoLayer {
  setVideo(video: RoomVideo | null, meta?: VideoMeta): void;
  setVolume(volume: number): void;
  setMuted(muted: boolean): void;
  /** Position et durée actuelles du lecteur local. */
  time(): { current: number; duration: number; title?: string; seekable: boolean };
  destroy(): void;
}

export function createVideoLayer(root: HTMLElement, opts: { muted?: boolean; onError?: (msg: string) => void } = {}): VideoLayer {
  injectStyleOnce();
  let video: RoomVideo | null = null;
  let meta: VideoMeta = {};
  let driver: Driver | null = null;
  let driverKind: string | null = null;
  let ready = false;
  /** Clé de ce qui est chargé dans le pilote (source + id, ou relance d'un clip). */
  let loadedKey: string | null = null;
  let frame: HTMLElement | null = null;
  let muted = !!opts.muted;
  let volume = 50;
  let errorShown = false;
  let calmTimer: ReturnType<typeof setTimeout> | undefined;
  /** Secondes passées à attendre une lecture qui ne démarre pas (lecture automatique bloquée). */
  let stuck = 0;
  let autoMuted = false;
  /** Moment du dernier chargement : sans image au bout de 15 s, on l'explique. */
  let loadAt = 0;
  let resumeTimer: ReturnType<typeof setTimeout> | undefined;
  /** Début de lecture constaté : l'écran de démarrage reste 2,5 s (titre YouTube). */
  let playingSince = 0;

  function place() {
    if (!frame || !video) return;
    const k = root.clientHeight / 1080 || 1;
    root.style.setProperty("--k", String(k));
    const full = video.width >= 1920;
    frame.classList.toggle("full", full);
    const cell = Math.min(8, Math.max(0, Math.round(video.cell)));
    const col = cell % 3, row = Math.floor(cell / 3);
    const m = full ? 0 : 40 * k;
    // Place des bandeaux extérieurs du style K-OS (titre au-dessus, minutage dessous).
    const outside = !full && (video.style ?? "kos") === "kos";
    const above = outside ? 44 * k : 0, below = outside ? 30 * k : 0;
    const H = root.clientHeight, W = root.clientWidth;
    const w = Math.min(W - 2 * m, video.width * k, full ? Infinity : ((H - 2 * m - above - below) * 16) / 9);
    const h = (w * 9) / 16;
    const left = col === 0 ? m : col === 1 ? (W - w) / 2 : W - w - m;
    const top = row === 0 ? m + above : row === 1 ? (H - h + above - below) / 2 : H - h - m - below;
    Object.assign(frame.style, { left: `${left}px`, top: `${top}px`, width: `${w}px` });
  }
  new ResizeObserver(place).observe(root);

  function applyAudio() {
    if (!driver || !ready) return;
    driver.audio(muted || autoMuted, volume);
  }

  function showError(msg: string) {
    if (!frame || errorShown) return;
    errorShown = true;
    const el = document.createElement("div");
    el.className = "err";
    el.textContent = msg;
    frame.querySelector(".screen")!.appendChild(el);
    opts.onError?.(msg);
  }
  function clearError() {
    errorShown = false;
    frame?.querySelector(".err")?.remove();
  }

  /** Les bandeaux restent visibles quelques secondes, puis s'effacent. */
  function wake(ms = 6000) {
    if (!frame) return;
    frame.classList.remove("calm");
    clearTimeout(calmTimer);
    calmTimer = setTimeout(() => frame?.classList.add("calm"), ms);
  }

  function buildFrame() {
    frame = document.createElement("div");
    frame.className = "kos-video enter";
    frame.innerHTML = `
      <div class="edge"></div>
      <div class="screen"><div class="slot"></div><div class="fx"></div>
        <div class="pause">❚❚ EN PAUSE</div>
        <div class="boot"><span>▌ TRANSMISSION ENTRANTE</span></div>
      </div>
      <div class="hud top"><span class="tag"></span><span class="ttl"></span><span class="by"></span></div>
      <div class="hud bottom"><span class="tc">0:00</span><span class="bar"><i></i></span><span class="tc dur"></span></div>
      <span class="corner tl"></span><span class="corner tr"></span><span class="corner bl"></span><span class="corner br"></span>`;
    frame.addEventListener("animationend", (e) => {
      if (e.animationName === "kosv-in") frame?.classList.remove("enter");
      if (e.animationName === "kosv-glitch") frame?.classList.remove("glitch");
    });
    root.appendChild(frame);
    wake();
  }

  function ensureDriver() {
    if (!video) return;
    const kind = sourceOf(video);
    if (driver && driverKind === kind) return;
    driver?.destroy();
    ready = false;
    loadedKey = null;
    if (!frame) buildFrame();
    const slot = frame!.querySelector<HTMLElement>(".slot")!;
    slot.replaceChildren();
    const inner = document.createElement("div");
    slot.appendChild(inner);
    const onReady = () => {
      ready = true;
      applyAudio();
      sync();
    };
    const onErr = (msg: string) => showError(msg);
    driverKind = kind;
    driver =
      kind === "twitch-vod" ? twitchVodDriver(inner, onReady, onErr)
      : kind === "twitch-clip" ? twitchClipDriver(inner, onReady)
      : kind === "file" ? fileDriver(inner, onReady, onErr)
      : youtubeDriver(inner, onReady, onErr);
  }

  function teardown() {
    clearTimeout(calmTimer);
    driver?.destroy();
    driver = null;
    driverKind = null;
    ready = false;
    loadedKey = null;
    errorShown = false;
    const old = frame;
    frame = null;
    if (!old) return;
    if (old.classList.contains("kos") && !document.hidden) {
      old.classList.remove("enter");
      old.classList.add("leave");
      setTimeout(() => old.remove(), 460);
    } else old.remove();
  }

  function renderHud() {
    if (!frame || !video) return;
    const style = video.style ?? "kos";
    frame.classList.toggle("kos", style === "kos");
    frame.classList.toggle("src-file", sourceOf(video) === "file");
    frame.classList.toggle("plain", style !== "kos");
    if (meta.color) frame.style.setProperty("--c", meta.color);
    frame.querySelector(".tag")!.textContent = `K-OS // ${SOURCE_LABELS[sourceOf(video)].toUpperCase()}`;
    frame.querySelector(".ttl")!.textContent = video.title || driver?.title?.() || "";
    frame.querySelector(".by")!.textContent = meta.name ? `▸ ${meta.name}` : "";
    const paused = video.state !== "playing";
    const wasPaused = frame.classList.contains("paused");
    if (paused !== wasPaused) wake();
    frame.classList.toggle("paused", paused);
    if (wasPaused && !paused && sourceOf(video) === "youtube") {
      const pause = frame.querySelector<HTMLElement>(".pause")!;
      pause.textContent = "▶ REPRISE DU SIGNAL";
      frame.classList.add("resuming");
      clearTimeout(resumeTimer);
      const f = frame;
      resumeTimer = setTimeout(() => {
        f.classList.remove("resuming");
        pause.textContent = "❚❚ EN PAUSE";
      }, 5500);
    } else if (paused) {
      clearTimeout(resumeTimer);
      frame.classList.remove("resuming");
      frame.querySelector(".pause")!.textContent = "❚❚ EN PAUSE";
    }
  }

  function renderProgress() {
    if (!frame || !driver || !ready) return;
    const cur = driver.current(), dur = driver.duration();
    const [tc, dc] = frame.querySelectorAll<HTMLElement>(".hud.bottom .tc");
    tc.textContent = fmt(cur);
    dc.textContent = dur ? fmt(dur) : "";
    frame.querySelector<HTMLElement>(".bar i")!.style.width = dur ? `${Math.min(100, (cur / dur) * 100)}%` : "0";
    const st = driver.status();
    if (st === "playing") playingSince ||= Date.now();
    const settled = st === "paused" || st === "ended" || (st === "playing" && (driverKind !== "youtube" || Date.now() - playingSince > 2500));
    if (settled) frame.classList.add("live");
    const ended = st === "ended" && video?.state === "playing";
    if (ended !== frame.classList.contains("ended")) {
      frame.classList.toggle("ended", ended);
      frame.querySelector(".pause")!.textContent = ended ? "■ FIN DE TRANSMISSION" : "❚❚ EN PAUSE";
      wake();
    }
  }

  function sync() {
    if (!video || !driver || !ready) return;
    const expected = expectedPosition(video, serverNow());
    const kind = sourceOf(video);
    // Un clip est relancé du début à chaque nouvelle commande "lecture".
    const key = kind === "twitch-clip" ? `${kind}:${video.videoId}:${video.state}:${video.state === "playing" ? video.updatedAt : 0}` : `${kind}:${video.videoId}`;
    if (loadedKey !== key) {
      loadedKey = key;
      clearError();
      frame?.classList.remove("live");
      loadAt = Date.now();
      playingSince = 0;
      applyAudio();
      driver.load(video.videoId, expected, video.state === "playing");
      return;
    }
    renderProgress();
    if (frame && !frame.classList.contains("live") && !errorShown && Date.now() - loadAt > 15000) {
      showError(
        kind === "twitch-vod"
          ? "La VOD Twitch ne démarre pas : privée, réservée aux abonnés ou supprimée ?"
          : "La vidéo ne démarre pas : lien invalide ou vidéo indisponible ?",
      );
    }
    if (!driver.seekable) return;
    const st = driver.status();
    const current = driver.current();
    const duration = driver.duration();
    if (video.state === "playing") {
      if (duration && expected >= duration) return; // vidéo terminée pour tout le monde
      if (Math.abs(current - expected) > DRIFT_S && st !== "buffering") {
        driver.seek(expected);
        if (frame?.classList.contains("kos")) frame.classList.add("glitch");
      }
      if (st !== "playing" && st !== "buffering" && st !== "ended") {
        // Un navigateur peut refuser la lecture automatique avec le son (pas OBS) :
        // au bout de 3 s on relance en muet pour que l'image reste synchronisée.
        if (++stuck >= 3 && !muted && !autoMuted) {
          autoMuted = true;
          applyAudio();
        }
        driver.play();
      } else stuck = 0;
    } else {
      if (st === "playing" || st === "buffering") driver.pause();
      if (Math.abs(current - expected) > 0.5) driver.seek(expected);
    }
  }
  const timer = setInterval(sync, 1000);

  return {
    setVideo(next, m) {
      const prev = video;
      video = next;
      meta = m ?? meta;
      if (!next) return teardown();
      if (!frame) buildFrame();
      else if (prev && (prev.videoId !== next.videoId || sourceOf(prev) !== sourceOf(next))) {
        clearError();
        frame.classList.add("glitch");
        wake();
      }
      ensureDriver();
      renderHud();
      place();
      sync();
    },
    setVolume(v) {
      volume = v;
      applyAudio();
    },
    setMuted(m) {
      muted = m;
      if (!m) autoMuted = false;
      applyAudio();
    },
    time() {
      const seekable = driver?.seekable ?? true;
      if (!driver || !ready) return { current: video ? expectedPosition(video, serverNow()) : 0, duration: 0, seekable };
      return { current: driver.current(), duration: driver.duration(), title: driver.title?.(), seekable };
    },
    destroy() {
      clearInterval(timer);
      teardown();
    },
  };
}
