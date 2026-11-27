import { SCALE, fadeAlpha, type Cursor, type Item, type Stroke } from "./room";
import { serverNow } from "./serverTime";
import { isAllowedMediaUrl, isVideoUrl } from "./gifs";

// Rendu d'un salon, partagé par l'overlay OBS (1920 x 1080) et la page du salon
// (taille variable). Les traits et lasers sont dessinés sur un canvas ; textes
// et GIF sont des éléments positionnés en %, mis à l'échelle via --k (= hauteur / 1080).

const STYLE = `
.kos-room { position: absolute; inset: 0; overflow: hidden; --k: 1; }
.kos-room-items, .kos-room-canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
.kos-room-canvas { pointer-events: none; }
.kos-room-items { pointer-events: none; }
.kos-room-item { position: absolute; transform: translate(-50%, -50%); white-space: pre; line-height: 1.15; user-select: none; }
.kos-room-item .t { font: 800 calc(var(--k) * var(--s) * 1px) / 1.15 "Segoe UI", system-ui, sans-serif; color: var(--c);
  -webkit-text-stroke: calc(var(--k) * var(--s) * 0.09px) #000; paint-order: stroke fill; text-shadow: 0 0 calc(var(--k) * 14px) rgba(0,0,0,0.6); }
.kos-room-item img, .kos-room-item video { display: block; height: calc(var(--k) * var(--s) * 1px); width: auto; border-radius: calc(var(--k) * 8px);
  box-shadow: 0 0 0 calc(var(--k) * 2px) var(--c), 0 0 calc(var(--k) * 20px) color-mix(in srgb, var(--c) 50%, transparent); }
.kos-room.editable .kos-room-items.movable { pointer-events: auto; }
.kos-room.editable .kos-room-items.movable .kos-room-item { cursor: grab; }
.kos-room-item.selected { outline: 2px dashed #fff; outline-offset: 6px; border-radius: 6px; }
`;

function injectStyleOnce() {
  if (document.getElementById("kos-room-style")) return;
  const style = document.createElement("style");
  style.id = "kos-room-style";
  style.textContent = STYLE;
  document.head.appendChild(style);
}

const safeColor = (c: string | undefined) => (c && /^#[0-9a-f]{3,8}$/i.test(c) ? c : "#00d4ff");
const TRAIL_MS = 500;
const CURSOR_TTL_MS = 2500;

export interface RoomView {
  setStrokes(strokes: Map<string, Stroke>): void;
  setItems(items: Map<string, Item>): void;
  setCursors(cursors: Record<string, Cursor>): void;
  /** Trait en cours de l'utilisateur, affiché sans attendre le serveur. */
  setLocalStroke(stroke: Stroke | null): void;
  /** Laser de l'utilisateur, affiché sans attendre le serveur. */
  setLocalCursor(actorId: string, cursor: Cursor | null): void;
  itemElement(id: string): HTMLElement | undefined;
  clear(): void;
}

export function createRoomView(root: HTMLElement, opts: { editable?: boolean } = {}): RoomView {
  injectStyleOnce();
  root.classList.add("kos-room");
  if (opts.editable) root.classList.add("editable");
  const itemsLayer = document.createElement("div");
  itemsLayer.className = "kos-room-items";
  const canvas = document.createElement("canvas");
  canvas.className = "kos-room-canvas";
  root.append(itemsLayer, canvas);
  const ctx = canvas.getContext("2d")!;

  let strokes = new Map<string, Stroke>();
  let local: Stroke | null = null;
  let cursors: Record<string, Cursor> = {};
  const localCursors = new Map<string, Cursor>();
  const trails = new Map<string, { x: number; y: number; t: number }[]>();
  const itemEls = new Map<string, HTMLElement>();
  let items = new Map<string, Item>();
  let w = 0, h = 0, k = 1;
  let frame = 0;

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    w = root.clientWidth;
    h = root.clientHeight;
    k = h / 1080 || 1;
    root.style.setProperty("--k", String(k));
    canvas.width = Math.max(1, Math.round(w * dpr));
    canvas.height = Math.max(1, Math.round(h * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    schedule();
  }
  new ResizeObserver(resize).observe(root);

  function schedule() {
    if (!frame) frame = requestAnimationFrame(draw);
  }
  // Les éléments éphémères commencent à s'effacer plus tard : vérification régulière.
  setInterval(schedule, 400);

  function drawStroke(s: Stroke, alpha: number) {
    const p = s.points;
    if (p.length < 2) return;
    const X = (i: number) => (p[i] / SCALE) * w;
    const Y = (i: number) => (p[i + 1] / SCALE) * h;
    const color = safeColor(s.color);
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = Math.max(1, s.width * k);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.shadowColor = color;
    ctx.shadowBlur = 6 * k;
    if (p.length < 4) {
      ctx.beginPath();
      ctx.arc(X(0), Y(0), ctx.lineWidth / 2, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    ctx.beginPath();
    ctx.moveTo(X(0), Y(0));
    for (let i = 2; i < p.length - 2; i += 2) {
      ctx.quadraticCurveTo(X(i), Y(i), (X(i) + X(i + 2)) / 2, (Y(i) + Y(i + 2)) / 2);
    }
    ctx.lineTo(X(p.length - 2), Y(p.length - 2));
    ctx.stroke();
  }

  function draw() {
    frame = 0;
    const now = serverNow();
    const t = performance.now();
    let again = false;
    ctx.clearRect(0, 0, w, h);

    for (const s of strokes.values()) {
      if (local && s.id === local.id) continue;
      const a = fadeAlpha(s.fade, s.end, s.done, now);
      if (a > 0) drawStroke(s, a);
      if (a > 0 && a < 1) again = true;
    }
    if (local) drawStroke(local, 1);

    for (const [id, el] of itemEls) {
      const it = items.get(id);
      if (!it) continue;
      const a = fadeAlpha(it.fade, it.end, true, now);
      el.style.opacity = String(a);
      el.style.visibility = a > 0 ? "" : "hidden";
      if (a > 0 && a < 1) again = true;
    }

    // Lasers : point lumineux + traînée courte, avec le nom.
    ctx.shadowBlur = 0;
    const all = new Map<string, Cursor>(Object.entries(cursors));
    for (const [id, c] of localCursors) all.set(id, c);
    for (const [id, c] of all) {
      const fresh = c.on && (localCursors.has(id) || now - c.ts < CURSOR_TTL_MS);
      const trail = trails.get(id) ?? [];
      while (trail.length && t - trail[0].t > TRAIL_MS) trail.shift();
      if (!fresh && !trail.length) continue;
      again = true;
      const color = safeColor(c.color);
      ctx.strokeStyle = color;
      ctx.lineCap = "round";
      for (let i = 1; i < trail.length; i++) {
        ctx.globalAlpha = (1 - (t - trail[i].t) / TRAIL_MS) * 0.8;
        ctx.lineWidth = 6 * k;
        ctx.beginPath();
        ctx.moveTo((trail[i - 1].x / SCALE) * w, (trail[i - 1].y / SCALE) * h);
        ctx.lineTo((trail[i].x / SCALE) * w, (trail[i].y / SCALE) * h);
        ctx.stroke();
      }
      if (!fresh) continue;
      const x = (c.x / SCALE) * w, y = (c.y / SCALE) * h;
      ctx.globalAlpha = 1;
      ctx.shadowColor = color;
      ctx.shadowBlur = 18 * k;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, 9 * k, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(x, y, 3.5 * k, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = `700 ${Math.round(15 * k)}px "Segoe UI", sans-serif`;
      ctx.lineWidth = 4 * k;
      ctx.strokeStyle = "rgba(0,0,0,0.8)";
      ctx.strokeText(c.name, x + 14 * k, y - 12 * k);
      ctx.fillStyle = color;
      ctx.fillText(c.name, x + 14 * k, y - 12 * k);
    }
    ctx.globalAlpha = 1;
    if (again) schedule();
  }

  function pushTrail(id: string, c: Cursor) {
    if (!c.on) return;
    const list = trails.get(id) ?? [];
    const last = list[list.length - 1];
    if (!last || last.x !== c.x || last.y !== c.y) list.push({ x: c.x, y: c.y, t: performance.now() });
    trails.set(id, list);
  }

  function renderItem(it: Item) {
    let el = itemEls.get(it.id);
    if (!el) {
      el = document.createElement("div");
      el.className = "kos-room-item";
      el.dataset.id = it.id;
      if (it.type === "text") {
        const t = document.createElement("div");
        t.className = "t";
        el.appendChild(t);
      } else if (it.url && isAllowedMediaUrl(it.url)) {
        const media = isVideoUrl(it.url) ? document.createElement("video") : document.createElement("img");
        if (media instanceof HTMLVideoElement) Object.assign(media, { muted: true, autoplay: true, loop: true, playsInline: true });
        media.draggable = false;
        media.src = it.url;
        el.appendChild(media);
      }
      itemsLayer.appendChild(el);
      itemEls.set(it.id, el);
    }
    el.style.left = `${(it.x / SCALE) * 100}%`;
    el.style.top = `${(it.y / SCALE) * 100}%`;
    el.style.setProperty("--s", String(it.size));
    el.style.setProperty("--c", safeColor(it.color));
    if (it.type === "text") el.querySelector<HTMLElement>(".t")!.textContent = it.text ?? "";
  }

  return {
    setStrokes(map) {
      strokes = map;
      schedule();
    },
    setItems(map) {
      items = map;
      for (const [id, el] of itemEls) if (!map.has(id)) { el.remove(); itemEls.delete(id); }
      for (const it of map.values()) renderItem(it);
      schedule();
    },
    setCursors(map) {
      cursors = map;
      for (const [id, c] of Object.entries(map)) if (!localCursors.has(id)) pushTrail(id, c);
      schedule();
    },
    setLocalStroke(stroke) {
      local = stroke;
      schedule();
    },
    setLocalCursor(id, c) {
      if (c) {
        localCursors.set(id, c);
        pushTrail(id, c);
      } else localCursors.delete(id);
      schedule();
    },
    itemElement: (id) => itemEls.get(id),
    clear() {
      strokes = new Map();
      items = new Map();
      cursors = {};
      local = null;
      itemEls.forEach((el) => el.remove());
      itemEls.clear();
      trails.clear();
      schedule();
    },
  };
}
