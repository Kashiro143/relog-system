import { watchIncomingGifs, watchGifZone, isVideoUrl, DEFAULT_ZONE, type GifSend, type GifZone } from "./gifs";

// Affichage des GIF reçus sur l'overlay OBS d'un membre : un à la fois, dans la
// zone qu'il a choisie, avec le nom de l'envoyeur. File d'attente limitée pour
// qu'une rafale ne bloque pas l'écran pendant des minutes.

const MAX_QUEUE = 5;
const MARGIN = 60;
const LOAD_TIMEOUT_MS = 5000;

const STYLE = `
.kos-gif-root { position: absolute; inset: 0; pointer-events: none; }
.kos-gif { position: absolute; display: flex; flex-direction: column; gap: 8px; }
.kos-gif.col-0 { left: ${MARGIN}px; align-items: flex-start; }
.kos-gif.col-1 { left: 50%; transform: translateX(-50%); align-items: center; }
.kos-gif.col-2 { right: ${MARGIN}px; align-items: flex-end; }
.kos-gif.row-0 { top: ${MARGIN}px; }
.kos-gif.row-1 { top: 50%; translate: 0 -50%; }
.kos-gif.row-2 { bottom: ${MARGIN}px; }
.kos-gif-frame { position: relative; border-radius: 10px; overflow: hidden; box-shadow: 0 0 0 2px var(--c), 0 0 28px color-mix(in srgb, var(--c) 55%, transparent); background: #000; }
.kos-gif-frame img, .kos-gif-frame video { display: block; height: var(--h); width: auto; max-width: 800px; object-fit: contain; }
.kos-gif-tag { font: 700 18px/1 "JetBrains Mono", Consolas, monospace; letter-spacing: 2px; color: #fff; background: rgba(0,0,0,0.75);
  border-left: 4px solid var(--c); padding: 7px 12px; border-radius: 4px; max-width: 640px; text-transform: uppercase; }
.kos-gif-tag small { display: block; margin-top: 5px; font: 600 16px/1.3 "Segoe UI", sans-serif; letter-spacing: 0; text-transform: none; opacity: 0.9; }
.kos-gif.enter { animation: kos-gif-in 0.45s cubic-bezier(0.16, 1, 0.3, 1) both; }
.kos-gif.leave { animation: kos-gif-out 0.35s ease-in both; }
@keyframes kos-gif-in {
  0% { opacity: 0; filter: blur(6px) hue-rotate(90deg); clip-path: inset(0 0 100% 0); }
  60% { opacity: 1; filter: blur(0) hue-rotate(0); }
  100% { opacity: 1; clip-path: inset(0 0 0 0); }
}
@keyframes kos-gif-out { to { opacity: 0; filter: blur(4px); clip-path: inset(100% 0 0 0); } }
`;

function injectStyleOnce() {
  if (document.getElementById("kos-gif-style")) return;
  const style = document.createElement("style");
  style.id = "kos-gif-style";
  style.textContent = STYLE;
  document.head.appendChild(style);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function loadMedia(url: string): Promise<HTMLElement | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), LOAD_TIMEOUT_MS);
    const done = (el: HTMLElement | null) => {
      clearTimeout(timer);
      resolve(el);
    };
    if (isVideoUrl(url)) {
      const video = document.createElement("video");
      Object.assign(video, { muted: true, autoplay: true, loop: true, playsInline: true });
      video.onloadeddata = () => done(video);
      video.onerror = () => done(null);
      video.src = url;
    } else {
      const img = new Image();
      img.onload = () => done(img);
      img.onerror = () => done(null);
      img.src = url;
    }
  });
}

export interface GifDisplay {
  /** Bouton panique : vide la file et l'écran, ignore les GIF tant que c'est coupé. */
  setMuted(muted: boolean): void;
}

export function mountGifDisplay(root: HTMLElement, actorId: string): GifDisplay {
  injectStyleOnce();
  root.classList.add("kos-gif-root");

  let zone: GifZone = DEFAULT_ZONE;
  const queue: GifSend[] = [];
  let playing = false;
  let muted = false;
  let generation = 0;

  watchGifZone(actorId, (z) => (zone = z));

  async function play() {
    if (playing) return;
    playing = true;
    const myGen = generation;
    while (queue.length && myGen === generation) {
      const gif = queue.shift()!;
      const media = await loadMedia(gif.url);
      if (!media || myGen !== generation) continue;

      const cell = Math.min(8, Math.max(0, Math.round(zone.cell)));
      const el = document.createElement("div");
      el.className = `kos-gif enter col-${cell % 3} row-${Math.floor(cell / 3)}`;
      el.style.setProperty("--c", /^#[0-9a-f]{3,8}$/i.test(gif.color) ? gif.color : "#00d4ff");
      el.style.setProperty("--h", `${Math.min(900, Math.max(120, zone.height))}px`);

      const frame = document.createElement("div");
      frame.className = "kos-gif-frame";
      frame.appendChild(media);

      const tag = document.createElement("div");
      tag.className = "kos-gif-tag";
      tag.textContent = `▸ ${gif.fromName || gif.from}`;
      if (gif.caption) {
        const small = document.createElement("small");
        small.textContent = gif.caption.slice(0, 120);
        tag.appendChild(small);
      }

      // Étiquette au-dessus du GIF si la zone est en bas, en dessous sinon.
      if (cell >= 6) el.append(tag, frame);
      else el.append(frame, tag);
      root.appendChild(el);

      await sleep(Math.min(20, Math.max(2, zone.seconds)) * 1000);
      el.classList.replace("enter", "leave");
      await sleep(350);
      el.remove();
      await sleep(150);
    }
    // Une file vidée par la panique a déjà relâché "playing" : ne pas écraser une nouvelle lecture.
    if (myGen === generation) playing = false;
  }

  watchIncomingGifs(actorId, (gif) => {
    if (muted || queue.length >= MAX_QUEUE) return;
    queue.push(gif);
    play();
  });

  return {
    setMuted(value) {
      muted = value;
      if (!value) return;
      generation++;
      queue.length = 0;
      root.replaceChildren();
      playing = false;
    },
  };
}
