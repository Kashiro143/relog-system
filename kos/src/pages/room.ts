import "../theme.css";
import { ref, onValue, type Unsubscribe } from "firebase/database";
import { db } from "../firebase";
import { requireMember, blockPage } from "../auth";
import { watchActors } from "../registry";
import type { Actor } from "../types";
import {
  MAX_POINTS_CHARS,
  SCALE,
  addItem,
  createRoom,
  deleteRoom,
  finishStroke,
  isExpired,
  joinRoom,
  leaveRoom,
  moveItem,
  newStrokeId,
  pointsLength,
  removeContent,
  setCursor,
  startStroke,
  updateStroke,
  watchCursors,
  watchItems,
  watchRooms,
  watchStrokes,
  type Item,
  type RoomMeta,
  type Stroke,
} from "../relog/room";
import { createRoomView } from "../relog/roomView";
import { mountGifPicker } from "../relog/gifPicker";
import { pushRecent, type GifMedia } from "../relog/gifs";
import { serverNow } from "../relog/serverTime";
import { createVideoLayer } from "../relog/videoLayer";
import { SOURCE_LABELS, controlVideo, expectedPosition, sourceOf, watchMyParty, watchParties, watchVideo, watchVolume, type PartyMeta, type RoomVideo } from "../relog/watch";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const member = await requireMember();
const me = member.actorId;
if (!me) {
  blockPage("Membre non lié", "Ton adresse n'est liée à aucun membre Re:log : demande à Kashiro de t'inviter depuis la page Membres.");
  throw new Error("[K-OS] membre non lié");
}

type Tool = "pen" | "laser" | "text" | "gif" | "move";
const SIZES: Record<"pen" | "text" | "gif", number[]> = { pen: [4, 8, 16], text: [36, 60, 96], gif: [200, 320, 480] };
const PALETTE = ["#ffffff", "#ffd34d", "#ff4757", "#00e58a", "#a46bff", "#00d4ff"];

let actors: Record<string, Actor> = {};
let overlays: Record<string, { room?: string; muted?: boolean }> = {};
let rooms: Record<string, RoomMeta> = {};
let myRoom: string | null = null;
let strokes = new Map<string, Stroke>();
let items = new Map<string, Item>();
let roomStops: Unsubscribe[] = [];

const state = {
  tool: "pen" as Tool,
  color: "",
  size: 1,
  fade: 15,
  gif: null as GifMedia | null,
  selectedItem: null as string | null,
};
const undoStack: string[] = [];

const myColor = () => actors[me!]?.color || "#00d4ff";
const myName = () => actors[me!]?.name || me!;

function showError(text: string) {
  const el = $("error");
  el.textContent = text;
  if (text) setTimeout(() => el.textContent === text && (el.textContent = ""), 4000);
}

// ---------- Liste des salons ----------

function participants(roomId: string): Actor[] {
  return Object.entries(overlays)
    .filter(([id, o]) => o?.room === roomId && actors[id]?.name)
    .map(([id]) => actors[id]);
}

function armed(btn: HTMLButtonElement, onConfirm: () => void) {
  const label = btn.textContent;
  let timer: ReturnType<typeof setTimeout>;
  btn.addEventListener("click", () => {
    if (!btn.classList.contains("armed")) {
      btn.classList.add("armed");
      btn.textContent = "Confirmer ?";
      timer = setTimeout(() => {
        btn.classList.remove("armed");
        btn.textContent = label;
      }, 3000);
      return;
    }
    clearTimeout(timer);
    btn.classList.remove("armed");
    btn.textContent = label;
    onConfirm();
  });
}

function renderRooms() {
  const box = $("rooms");
  box.replaceChildren();
  const list = Object.entries(rooms).sort(([, a], [, b]) => (b.createdAt || 0) - (a.createdAt || 0));
  if (!list.length) {
    const p = document.createElement("div");
    p.className = "empty";
    p.textContent = "Aucun salon pour l'instant : crée le premier.";
    box.appendChild(p);
    return;
  }
  for (const [id, r] of list) {
    const card = document.createElement("div");
    card.className = `room-card${id === myRoom ? " mine" : ""}`;
    const top = document.createElement("div");
    top.className = "top";
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = r.name;
    top.appendChild(name);

    const people = document.createElement("div");
    people.className = "people";
    const ps = participants(id);
    if (!ps.length) people.innerHTML = `<span style="font-size:11px;color:var(--text-dim)">Personne pour l'instant</span>`;
    for (const a of ps) {
      const p = document.createElement("span");
      p.className = "person";
      p.style.setProperty("--c", a.color || "#00d4ff");
      p.textContent = a.name;
      people.appendChild(p);
    }

    const acts = document.createElement("div");
    acts.className = "acts";
    const join = document.createElement("button");
    if (id === myRoom) {
      join.textContent = "Quitter";
      join.addEventListener("click", () => leaveRoom(me!, myRoom));
    } else {
      join.textContent = myRoom ? "Rejoindre (quitte l'autre)" : "Rejoindre";
      join.className = "join";
      join.addEventListener("click", async () => {
        if (myRoom) await leaveRoom(me!, myRoom);
        await joinRoom(me!, id);
      });
    }
    acts.appendChild(join);
    if (r.by === me || member.isOwner) {
      const del = document.createElement("button");
      del.className = "del";
      del.textContent = "Supprimer";
      del.title = "Supprime le salon et tout son contenu";
      armed(del, () => deleteRoom(id).catch(() => showError("Suppression refusée.")));
      acts.appendChild(del);
    }
    card.append(top, people, acts);
    box.appendChild(card);
  }
}

$("create-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = $<HTMLInputElement>("create-name");
  const name = input.value.trim() || `Salon de ${myName()}`;
  try {
    const id = await createRoom(name, me!);
    if (myRoom) await leaveRoom(me!, myRoom);
    await joinRoom(me!, id);
    input.value = "";
  } catch {
    showError("Création refusée.");
  }
});

// ---------- Vue du salon ----------

const stage = $("stage");
const stageVideo = createVideoLayer($("video-view"), { muted: true });
let video: RoomVideo | null = null;
const capture = $("capture");
const view = createRoomView($("view"), { editable: true });

function enterRoom(roomId: string | null) {
  roomStops.forEach((stop) => stop());
  roomStops = [];
  view.clear();
  strokes = new Map();
  items = new Map();
  undoStack.length = 0;
  state.selectedItem = null;
  $("no-room").hidden = !!roomId;
  $("room-ui").hidden = !roomId;
  if (!roomId) return;
  roomStops = [
    watchStrokes(roomId, (m) => {
      strokes = m;
      view.setStrokes(m);
    }),
    watchItems(roomId, (m) => {
      items = m;
      view.setItems(m);
      markSelection();
    }),
    watchCursors(roomId, (c) => {
      const others = { ...c };
      delete others[me!];
      view.setCursors(others);
    }),
  ];
  renderHint();
}

// Les éléments éphémères expirés sont retirés de la base par les participants.
setInterval(() => {
  if (!myRoom) return;
  const now = serverNow();
  const paths = [
    ...[...strokes.values()].filter((s) => isExpired(s.fade, s.end, s.done, now)).map((s) => `strokes/${s.id}`),
    ...[...items.values()].filter((i) => isExpired(i.fade, i.end, true, now)).map((i) => `items/${i.id}`),
  ];
  removeContent(myRoom, paths).catch(() => {});
}, 5000);

// ---------- Outils ----------

function renderTools() {
  $("tools").querySelectorAll<HTMLButtonElement>("button").forEach((b) => b.classList.toggle("on", b.dataset.tool === state.tool));
  $("sizes").querySelectorAll<HTMLButtonElement>("button").forEach((b) => b.classList.toggle("on", Number(b.dataset.size) === state.size));
  $("fades").querySelectorAll<HTMLButtonElement>("button").forEach((b) => b.classList.toggle("on", Number(b.dataset.fade) === state.fade));
  const sw = $("swatches");
  sw.replaceChildren();
  for (const c of [myColor(), ...PALETTE.filter((p) => p.toLowerCase() !== myColor().toLowerCase())]) {
    const b = document.createElement("button");
    b.className = `swatch${c === (state.color || myColor()) ? " on" : ""}`;
    b.style.setProperty("--c", c);
    b.title = c === myColor() ? "Ma couleur" : c;
    b.addEventListener("click", () => {
      state.color = c;
      renderTools();
    });
    sw.appendChild(b);
  }
  capture.className = `capture ${state.tool}${state.tool === "move" ? " off" : ""}`;
  $("view").querySelector(".kos-room-items")?.classList.toggle("movable", state.tool === "move");
  $("gif-panel").hidden = state.tool !== "gif";
  $("sizes").hidden = state.tool === "laser" || state.tool === "move";
  renderHint();
}

function renderHint() {
  const hints: Record<Tool, string> = {
    pen: "Dessine sur le tableau : chaque participant le voit sur son stream.",
    laser: "Maintiens le clic pour pointer : rien n'est conservé.",
    text: "Clique où écrire, tape ton texte puis Entrée.",
    gif: state.gif ? "Clique sur le tableau pour poser le GIF choisi." : "Choisis un GIF ci-dessous, puis clique sur le tableau pour le poser.",
    move: "Glisse tes textes et GIF pour les déplacer. Clique un élément puis Suppr pour l'effacer.",
  };
  const people = myRoom ? participants(myRoom).map((a) => a.name).join(", ") : "";
  $("hint").textContent = `${hints[state.tool]}${people ? `  ·  Dans le salon : ${people}` : ""}`;
}

$("tools").addEventListener("click", (e) => {
  const tool = (e.target as HTMLElement).dataset.tool as Tool | undefined;
  if (!tool) return;
  state.tool = tool;
  state.selectedItem = null;
  markSelection();
  renderTools();
});
$("sizes").addEventListener("click", (e) => {
  const s = (e.target as HTMLElement).dataset.size;
  if (s !== undefined) {
    state.size = Number(s);
    renderTools();
  }
});
$("fades").addEventListener("click", (e) => {
  const f = (e.target as HTMLElement).dataset.fade;
  if (f !== undefined) {
    state.fade = Number(f);
    renderTools();
  }
});

const currentColor = () => state.color || myColor();

function toBoard(e: PointerEvent | MouseEvent) {
  const r = stage.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(SCALE, Math.round(((e.clientX - r.left) / r.width) * SCALE))),
    y: Math.max(0, Math.min(SCALE, Math.round(((e.clientY - r.top) / r.height) * SCALE))),
  };
}

// --- Stylo ---

let drawing: { id: string; points: number[]; flushTimer: ReturnType<typeof setTimeout> | null } | null = null;

function localStroke(): Stroke | null {
  if (!drawing) return null;
  return { id: drawing.id, by: me!, color: currentColor(), width: SIZES.pen[state.size], points: drawing.points, fade: state.fade, done: false };
}

function beginStroke(x: number, y: number) {
  const id = newStrokeId(myRoom!);
  drawing = { id, points: [x, y], flushTimer: null };
  startStroke(myRoom!, id, { by: me!, color: currentColor(), width: SIZES.pen[state.size], points: [x, y], fade: state.fade }).catch(() =>
    showError("Dessin refusé : as-tu bien rejoint le salon ?"),
  );
  undoStack.push(`strokes/${id}`);
  view.setLocalStroke(localStroke());
}

function flushStroke() {
  if (!drawing) return;
  drawing.flushTimer = null;
  updateStroke(myRoom!, drawing.id, drawing.points).catch(() => {});
}

function addPoint(x: number, y: number) {
  if (!drawing) return;
  const p = drawing.points;
  const dx = x - p[p.length - 2], dy = y - p[p.length - 1];
  if (dx * dx + dy * dy < 400) return; // ~0,2 % de la largeur : évite les points inutiles
  p.push(x, y);
  if (pointsLength(p) > MAX_POINTS_CHARS) {
    // Trait trop long : on le termine et on enchaîne sur un nouveau, sans coupure visible.
    const last = p.slice(-2);
    finishStroke(myRoom!, drawing.id, p).catch(() => {});
    if (drawing.flushTimer) clearTimeout(drawing.flushTimer);
    beginStroke(last[0], last[1]);
    return;
  }
  view.setLocalStroke(localStroke());
  if (!drawing.flushTimer) drawing.flushTimer = setTimeout(flushStroke, 60);
}

function endStroke() {
  if (!drawing) return;
  if (drawing.flushTimer) clearTimeout(drawing.flushTimer);
  finishStroke(myRoom!, drawing.id, drawing.points).catch(() => {});
  drawing = null;
  // Le trait local reste affiché jusqu'à ce que le serveur renvoie la version finale.
  setTimeout(() => view.setLocalStroke(null), 150);
}

// --- Laser ---

let lasering = false;
let laserTimer: ReturnType<typeof setTimeout> | null = null;
let laserPos = { x: 0, y: 0 };

function sendLaser(on: boolean) {
  if (!myRoom) return;
  setCursor(myRoom, me!, { ...laserPos, on, color: currentColor(), name: myName() }).catch(() => {});
}

function moveLaser(x: number, y: number) {
  laserPos = { x, y };
  view.setLocalCursor(me!, { x, y, ts: serverNow(), on: true, color: currentColor(), name: myName() });
  if (!laserTimer) {
    laserTimer = setTimeout(() => {
      laserTimer = null;
      if (lasering) sendLaser(true);
    }, 40);
  }
}

// --- Texte ---

function openTextInput(x: number, y: number) {
  stage.querySelector(".text-input")?.remove();
  const input = document.createElement("input");
  input.className = "text-input";
  input.maxLength = 200;
  input.placeholder = "Écris puis Entrée";
  input.style.left = `${(x / SCALE) * 100}%`;
  input.style.top = `${(y / SCALE) * 100}%`;
  input.style.color = currentColor();
  stage.appendChild(input);
  setTimeout(() => input.focus(), 0);
  let done = false;
  const place = async () => {
    if (done) return;
    done = true;
    const text = input.value.trim();
    input.remove();
    if (!text || !myRoom) return;
    try {
      const id = await addItem(myRoom, { type: "text", by: me!, color: currentColor(), x, y, size: SIZES.text[state.size], text, fade: state.fade });
      undoStack.push(`items/${id}`);
    } catch {
      showError("Texte refusé.");
    }
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") place();
    if (e.key === "Escape") {
      done = true;
      input.remove();
    }
    e.stopPropagation();
  });
  input.addEventListener("blur", place);
}

// --- GIF ---

const picker = mountGifPicker($("picker"), {
  me,
  keepSelection: true,
  onPick: (gif) => {
    state.gif = gif;
    renderHint();
  },
  onError: showError,
});

async function placeGif(x: number, y: number) {
  if (!state.gif || !myRoom) return showError("Choisis d'abord un GIF ci-dessous.");
  try {
    const id = await addItem(myRoom, { type: "gif", by: me!, color: currentColor(), x, y, size: SIZES.gif[state.size], url: state.gif.url, sticker: !!state.gif.sticker, fade: state.fade });
    undoStack.push(`items/${id}`);
    pushRecent(state.gif);
    picker.refresh();
  } catch {
    showError("GIF refusé.");
  }
}

// --- Événements du tableau ---

capture.addEventListener("pointerdown", (e) => {
  if (!myRoom || e.button !== 0) return;
  const { x, y } = toBoard(e);
  if (state.tool === "pen") {
    capture.setPointerCapture(e.pointerId);
    beginStroke(x, y);
  } else if (state.tool === "laser") {
    capture.setPointerCapture(e.pointerId);
    lasering = true;
    moveLaser(x, y);
    sendLaser(true);
  } else if (state.tool === "text") {
    e.preventDefault();
    openTextInput(x, y);
  } else if (state.tool === "gif") {
    placeGif(x, y);
  }
});

capture.addEventListener("pointermove", (e) => {
  const events = e.getCoalescedEvents?.() ?? [e];
  for (const ev of events.length ? events : [e]) {
    const { x, y } = toBoard(ev);
    if (drawing) addPoint(x, y);
    else if (lasering) moveLaser(x, y);
  }
});

const release = () => {
  if (drawing) endStroke();
  if (lasering) {
    lasering = false;
    view.setLocalCursor(me!, null);
    sendLaser(false);
  }
};
capture.addEventListener("pointerup", release);
capture.addEventListener("pointercancel", release);

// --- Déplacer / sélectionner ---

function markSelection() {
  items.forEach((_, id) => view.itemElement(id)?.classList.toggle("selected", id === state.selectedItem));
}

$("view").addEventListener("pointerdown", (e) => {
  if (state.tool !== "move" || !myRoom) return;
  const el = (e.target as HTMLElement).closest<HTMLElement>(".kos-room-item");
  state.selectedItem = el?.dataset.id ?? null;
  markSelection();
  if (!el) return;
  const item = items.get(el.dataset.id!);
  if (!item || item.by !== me) return; // on ne déplace que ses propres éléments
  e.preventDefault();
  el.setPointerCapture(e.pointerId);
  let pos = { x: item.x, y: item.y };
  const onMove = (ev: PointerEvent) => {
    pos = toBoard(ev);
    el.style.left = `${(pos.x / SCALE) * 100}%`;
    el.style.top = `${(pos.y / SCALE) * 100}%`;
  };
  const onUp = () => {
    el.removeEventListener("pointermove", onMove);
    el.removeEventListener("pointerup", onUp);
    moveItem(myRoom!, item.id, pos.x, pos.y).catch(() => showError("Déplacement refusé."));
  };
  el.addEventListener("pointermove", onMove);
  el.addEventListener("pointerup", onUp);
});

document.addEventListener("keydown", (e) => {
  if ((e.target as HTMLElement).closest("input, textarea")) return;
  if ((e.key === "Delete" || e.key === "Backspace") && state.selectedItem && myRoom) {
    removeContent(myRoom, [`items/${state.selectedItem}`]).catch(() => showError("Suppression refusée."));
    state.selectedItem = null;
  }
  if (e.key === "z" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    undo();
  }
});

// ---------- Actions ----------

function undo() {
  if (!myRoom) return;
  while (undoStack.length) {
    const path = undoStack.pop()!;
    const [kind, id] = path.split("/");
    const exists = kind === "strokes" ? strokes.has(id) : items.has(id);
    if (exists) {
      removeContent(myRoom, [path]).catch(() => {});
      return;
    }
  }
}

$("undo").addEventListener("click", undo);
$("clear-mine").addEventListener("click", () => {
  if (!myRoom) return;
  const paths = [
    ...[...strokes.values()].filter((s) => s.by === me).map((s) => `strokes/${s.id}`),
    ...[...items.values()].filter((i) => i.by === me).map((i) => `items/${i.id}`),
  ];
  removeContent(myRoom, paths).catch(() => showError("Effacement refusé."));
});
armed($<HTMLButtonElement>("clear-all"), () => {
  if (!myRoom) return;
  const paths = [...[...strokes.keys()].map((id) => `strokes/${id}`), ...[...items.keys()].map((id) => `items/${id}`)];
  removeContent(myRoom, paths).catch(() => showError("Effacement refusé."));
});

// --- Mon écran en fond (local uniquement) ---

let screenStream: MediaStream | null = null;
$("screen-bg").addEventListener("click", async () => {
  const video = $<HTMLVideoElement>("bg-video");
  if (screenStream) {
    screenStream.getTracks().forEach((t) => t.stop());
    screenStream = null;
    video.hidden = true;
    $("screen-bg").textContent = "🖥 Mon écran en fond";
    return;
  }
  if (!navigator.mediaDevices?.getDisplayMedia) return showError("Ce navigateur ne permet pas de capturer l'écran (ouvre la page dans Chrome ou Edge).");
  try {
    screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    video.srcObject = screenStream;
    video.hidden = false;
    $("screen-bg").textContent = "🖥 Retirer l'écran";
    screenStream.getVideoTracks()[0].addEventListener("ended", () => {
      screenStream = null;
      video.hidden = true;
      $("screen-bg").textContent = "🖥 Mon écran en fond";
    });
  } catch {
    /* annulé par l'utilisateur */
  }
});

// ---------- Watch-party (indépendante du salon) ----------
// En fond de la scène : la vidéo de la watch-party que J'AI rejointe, avec de
// quoi la mettre en pause pour dessiner dessus (pour tout le monde).

let parties: Record<string, PartyMeta> = {};
let myParty: string | null = null;
let partyStop: (() => void) | null = null;

watchParties((data) => {
  parties = data;
  renderVideo();
});
watchMyParty(me, (party) => {
  myParty = party;
  partyStop?.();
  partyStop = null;
  video = null;
  stageVideo.setVideo(null);
  renderVideo();
  if (!party) return;
  partyStop = watchVideo(party, (v) => {
    video = v;
    stageVideo.setVideo(v, v ? { color: actors[v.by]?.color, name: actors[v.by]?.name || v.by } : undefined);
    renderVideo();
  });
});

function renderVideo() {
  const partyName = myParty && parties[myParty]?.name;
  $("video-status").textContent = !myParty
    ? "Tu n'as rejoint aucune watch-party."
    : video
      ? `${partyName ? `${partyName} · ` : ""}${video.state === "playing" ? "▶" : "❚❚"} ${video.title || SOURCE_LABELS[sourceOf(video)]}`
      : `${partyName || "Watch-party"} · aucune vidéo`;
  const seekable = !!video && sourceOf(video) !== "twitch-clip";
  $("wp-ctl").hidden = !video;
  $("wp-play").textContent = !video ? "" : sourceOf(video) === "twitch-clip" ? "↻ Rejouer" : video.state === "playing" ? "⏸ Pause" : "▶ Lecture";
  $("wp-back").hidden = $("wp-fwd").hidden = !seekable;
  $("video-view").hidden = !$<HTMLInputElement>("wp-show").checked;
}

const wpNow = () => (video ? expectedPosition(video, serverNow()) : 0);
const wpRefused = () => showError("Commande refusée : rejoins cette watch-party depuis sa page.");
function wpControl(state: RoomVideo["state"], position: number) {
  if (!myParty || !video) return;
  controlVideo(myParty, state, position).catch(wpRefused);
}
$("wp-play").addEventListener("click", () => {
  if (!video) return;
  if (sourceOf(video) === "twitch-clip") return wpControl("playing", 0);
  wpControl(video.state === "playing" ? "paused" : "playing", wpNow());
});
$("wp-back").addEventListener("click", () => video && wpControl(video.state, wpNow() - 10));
$("wp-fwd").addEventListener("click", () => video && wpControl(video.state, wpNow() + 10));
$("wp-show").addEventListener("change", renderVideo);
// Pause automatique au premier trait : pour figer l'image et l'annoter.
capture.addEventListener("pointerdown", () => {
  if (!$<HTMLInputElement>("wp-autopause").checked || !video || video.state !== "playing") return;
  if (state.tool === "move" || sourceOf(video) === "twitch-clip") return;
  wpControl("paused", wpNow());
});
// L'aperçu reste muet ici ; le volume suit quand même celui du membre.
watchVolume(me, (v) => stageVideo.setVolume(v));

// ---------- Données en direct ----------

watchActors((data) => {
  actors = data;
  renderRooms();
  renderTools();
});
let roomsLoaded = false;

/** Salon rejoint ; s'il a été supprimé entre-temps, on le quitte proprement. */
function syncMyRoom() {
  let room = overlays[me!]?.room ?? null;
  if (room && roomsLoaded && !rooms[room]) {
    leaveRoom(me!, room).catch(() => {});
    room = null;
  }
  if (room !== myRoom) {
    myRoom = room;
    enterRoom(myRoom);
  }
  renderRooms();
  renderHint();
}

watchRooms((data) => {
  rooms = data;
  roomsLoaded = true;
  syncMyRoom();
});
onValue(ref(db, "relog/overlay"), (snap) => {
  overlays = snap.val() ?? {};
  syncMyRoom();
});

renderTools();
enterRoom(null);
