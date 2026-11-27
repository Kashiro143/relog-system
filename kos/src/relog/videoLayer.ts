import { expectedPosition, type RoomVideo } from "./watch";
import { serverNow } from "./serverTime";

// Lecteur YouTube synchronisé sur l'état partagé du salon. Utilisé par
// l'overlay OBS (avec le son, au volume choisi par le membre) et par la page
// du salon (aperçu, muet par défaut).

interface YTPlayer {
  loadVideoById(opts: { videoId: string; startSeconds?: number }): void;
  cueVideoById(opts: { videoId: string; startSeconds?: number }): void;
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  getVideoData?(): { title?: string; video_id?: string };
  setVolume(v: number): void;
  mute(): void;
  unMute(): void;
  destroy(): void;
}
declare global {
  interface Window {
    YT?: { Player: new (el: HTMLElement, opts: unknown) => YTPlayer; PlayerState: Record<string, number> };
    onYouTubeIframeAPIReady?: () => void;
  }
}

const YT_PLAYING = 1;
const YT_BUFFERING = 3;
const YT_ENDED = 0;
/** Écart toléré avant de recaler la vidéo (s). */
const DRIFT_S = 1.5;

let apiPromise: Promise<void> | null = null;
function loadYouTubeApi(): Promise<void> {
  if (window.YT?.Player) return Promise.resolve();
  if (!apiPromise) {
    apiPromise = new Promise((resolve) => {
      const previous = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        previous?.();
        resolve();
      };
      const s = document.createElement("script");
      s.src = "https://www.youtube.com/iframe_api";
      document.head.appendChild(s);
    });
  }
  return apiPromise;
}

const STYLE = `
.kos-video { position: absolute; transition: left 0.3s, top 0.3s, width 0.3s; border-radius: calc(var(--k, 1) * 10px); overflow: hidden;
  box-shadow: 0 0 0 calc(var(--k, 1) * 2px) var(--c, #00d4ff), 0 0 calc(var(--k, 1) * 26px) rgba(0,0,0,0.6); background: #000; aspect-ratio: 16 / 9; }
.kos-video iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; pointer-events: none; }
.kos-video .err { position: absolute; inset: 0; display: grid; place-items: center; color: #fff; font: 600 calc(var(--k, 1) * 22px) "Segoe UI", sans-serif; text-align: center; padding: 10%; background: #111; }
`;
function injectStyleOnce() {
  if (document.getElementById("kos-video-style")) return;
  const style = document.createElement("style");
  style.id = "kos-video-style";
  style.textContent = STYLE;
  document.head.appendChild(style);
}

export interface VideoLayer {
  setVideo(video: RoomVideo | null, color?: string): void;
  setVolume(volume: number): void;
  setMuted(muted: boolean): void;
  /** Position et durée actuelles du lecteur local. */
  time(): { current: number; duration: number; title?: string };
  destroy(): void;
}

export function createVideoLayer(root: HTMLElement, opts: { muted?: boolean; onError?: (code: number) => void } = {}): VideoLayer {
  injectStyleOnce();
  let video: RoomVideo | null = null;
  let player: YTPlayer | null = null;
  let ready = false;
  let loadedId: string | null = null;
  let frame: HTMLElement | null = null;
  let muted = !!opts.muted;
  let volume = 50;
  let errorShown = false;
  /** Secondes passées à attendre une lecture qui ne démarre pas (lecture automatique bloquée). */
  let stuck = 0;

  function place() {
    if (!frame || !video) return;
    const k = root.clientHeight / 1080 || 1;
    root.style.setProperty("--k", String(k));
    const cell = Math.min(8, Math.max(0, Math.round(video.cell)));
    const col = cell % 3, row = Math.floor(cell / 3);
    const w = Math.min(root.clientWidth, video.width * k);
    const h = (w * 9) / 16;
    const m = 40 * k;
    const left = col === 0 ? m : col === 1 ? (root.clientWidth - w) / 2 : root.clientWidth - w - m;
    const top = row === 0 ? m : row === 1 ? (root.clientHeight - h) / 2 : root.clientHeight - h - m;
    Object.assign(frame.style, { left: `${left}px`, top: `${top}px`, width: `${w}px` });
  }
  new ResizeObserver(place).observe(root);

  function applyAudio() {
    if (!player || !ready) return;
    if (muted) player.mute();
    else {
      player.unMute();
      player.setVolume(volume);
    }
  }

  async function ensurePlayer() {
    if (frame) return;
    frame = document.createElement("div");
    frame.className = "kos-video";
    const slot = document.createElement("div");
    frame.appendChild(slot);
    root.appendChild(frame);
    place();
    await loadYouTubeApi();
    if (!frame) return;
    player = new window.YT!.Player(slot, {
      width: "100%",
      height: "100%",
      playerVars: { controls: 0, disablekb: 1, modestbranding: 1, rel: 0, playsinline: 1, iv_load_policy: 3, fs: 0, origin: location.origin },
      events: {
        onReady: () => {
          ready = true;
          applyAudio();
          sync();
        },
        onError: (e: { data: number }) => showError(e.data),
      },
    });
  }

  function showError(code: number) {
    if (!frame || errorShown) return;
    errorShown = true;
    const el = document.createElement("div");
    el.className = "err";
    el.textContent = code === 101 || code === 150 ? "Cette vidéo n'autorise pas la lecture intégrée." : "Vidéo indisponible.";
    frame.appendChild(el);
    opts.onError?.(code);
  }

  function teardown() {
    player?.destroy();
    player = null;
    ready = false;
    loadedId = null;
    frame?.remove();
    frame = null;
    errorShown = false;
  }

  function sync() {
    if (!video || !player || !ready) return;
    const expected = expectedPosition(video, serverNow());
    if (loadedId !== video.videoId) {
      loadedId = video.videoId;
      errorShown = false;
      frame?.querySelector(".err")?.remove();
      if (video.state === "playing") player.loadVideoById({ videoId: video.videoId, startSeconds: expected });
      else player.cueVideoById({ videoId: video.videoId, startSeconds: expected });
      return;
    }
    const st = player.getPlayerState();
    const current = player.getCurrentTime();
    const duration = player.getDuration();
    if (video.state === "playing") {
      if (duration && expected >= duration) return; // vidéo terminée pour tout le monde
      if (Math.abs(current - expected) > DRIFT_S && st !== YT_BUFFERING) player.seekTo(expected, true);
      if (st !== YT_PLAYING && st !== YT_BUFFERING && st !== YT_ENDED) {
        // Un navigateur peut refuser la lecture automatique avec le son (pas OBS) :
        // au bout de 3 s on relance en muet pour que l'image reste synchronisée.
        if (++stuck >= 3 && !muted) player.mute();
        player.playVideo();
      } else stuck = 0;
    } else {
      if (st === YT_PLAYING || st === YT_BUFFERING) player.pauseVideo();
      if (Math.abs(current - expected) > 0.5) player.seekTo(expected, true);
    }
  }
  const timer = setInterval(sync, 1000);

  return {
    setVideo(next, color) {
      const changedId = next?.videoId !== video?.videoId;
      video = next;
      if (!next) return teardown();
      if (color) root.style.setProperty("--c", color);
      if (changedId && frame) {
        frame.querySelector(".err")?.remove();
        errorShown = false;
      }
      ensurePlayer().then(() => {
        place();
        sync();
      });
    },
    setVolume(v) {
      volume = v;
      applyAudio();
    },
    setMuted(m) {
      muted = m;
      applyAudio();
    },
    time() {
      if (!player || !ready) return { current: video ? expectedPosition(video, serverNow()) : 0, duration: 0 };
      return { current: player.getCurrentTime(), duration: player.getDuration(), title: player.getVideoData?.()?.title };
    },
    destroy() {
      clearInterval(timer);
      teardown();
    },
  };
}
