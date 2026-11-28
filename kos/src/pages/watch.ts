import "../theme.css";
import { appUrl } from "../appUrl";
import { ref, onValue } from "firebase/database";
import { db } from "../firebase";
import { requireMember, blockPage } from "../auth";
import { watchActors } from "../registry";
import type { Actor } from "../types";
import { serverNow } from "../relog/serverTime";
import { createVideoLayer } from "../relog/videoLayer";
import { armConfirmDelete } from "../ui/dialogs";
import {
  DEFAULT_WIDTH,
  SOURCE_LABELS,
  VIDEO_SIZES,
  controlVideo,
  createParty,
  deleteParty,
  joinParty,
  leaveParty,
  watchParties,
  type PartyMeta,
  expectedPosition,
  parseVideoLink,
  setVideoLayout,
  setVideoTitle,
  setVolume,
  sourceOf,
  startVideo,
  stopVideo,
  watchVideo,
  watchVolume,
  type RoomVideo,
  type VideoStyle,
} from "../relog/watch";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const LAYOUT_KEY = "kos.watch.layout";

const member = await requireMember();
const me = member.actorId;
if (!me) {
  blockPage("Membre non lié", "Ton adresse n'est liée à aucun membre Re:log : demande à Kashiro de t'inviter depuis la page Membres.");
  throw new Error("[K-OS] membre non lié");
}

let actors: Record<string, Actor> = {};
let rooms: Record<string, PartyMeta> = {};
let overlays: Record<string, { party?: string }> = {};
let myRoom: string | null = null;
let video: RoomVideo | null = null;
let stopVideoWatch: (() => void) | null = null;

/** Réglages d'affichage utilisés au lancement (et quand aucune vidéo ne tourne). */
interface LayoutPrefs {
  cell: number;
  width: number;
  style: VideoStyle;
}
let prefs: LayoutPrefs = { cell: 4, width: DEFAULT_WIDTH, style: "kos" };
try {
  prefs = { ...prefs, ...JSON.parse(localStorage.getItem(LAYOUT_KEY) || "{}") };
} catch {
  /* stockage indisponible */
}
function savePrefs() {
  try {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(prefs));
  } catch {
    /* stockage indisponible */
  }
}

let errTimer: ReturnType<typeof setTimeout> | undefined;
function detect(kind: "ok" | "err" | "", text: string, sticky = true) {
  const el = $("detect");
  el.className = `detect ${kind}`;
  el.textContent = text;
  clearTimeout(errTimer);
  if (!sticky) errTimer = setTimeout(() => updateDetect(), 4000);
}

const layer = createVideoLayer($("video-root"), { muted: true, onError: (msg) => detect("err", msg, false) });

// ---------- Watch-party (indépendante des salons de dessin) ----------

function renderRoomBar() {
  const select = $<HTMLSelectElement>("room-select");
  const list = Object.entries(rooms).sort((a, b) => a[1].name.localeCompare(b[1].name));
  const current = select.value;
  select.replaceChildren();
  if (!list.length) {
    const o = document.createElement("option");
    o.textContent = "Aucune watch-party";
    o.value = "";
    select.appendChild(o);
  }
  for (const [id, r] of list) {
    const o = document.createElement("option");
    o.value = id;
    const count = Object.values(overlays).filter((ov) => ov?.party === id).length;
    o.textContent = `${r.name}${count ? ` · ${count}` : ""}${id === myRoom ? " (ici)" : ""}`;
    select.appendChild(o);
  }
  select.value = myRoom && rooms[myRoom] ? myRoom : rooms[current] ? current : list[0]?.[0] ?? "";
  select.disabled = !list.length;
  const joinBtn = $<HTMLButtonElement>("room-join");
  joinBtn.hidden = !list.length || select.value === myRoom;
  joinBtn.textContent = myRoom ? "Changer" : "Rejoindre";
  $("room-leave").hidden = !myRoom;
  $("room-share").hidden = !myRoom;
  // Supprimer : son créateur ou le propriétaire, et seulement la watch-party affichée.
  const sel = rooms[select.value];
  $("party-delete").hidden = !sel || !(sel.by === me || member.isOwner);

  const people = $("people");
  people.replaceChildren();
  if (!myRoom) return;
  for (const a of Object.values(actors)) {
    if (!a?.name || overlays[a.id]?.party !== myRoom) continue;
    const chip = document.createElement("span");
    chip.className = `person${a.status === "online" ? " online" : ""}`;
    chip.style.setProperty("--c", a.color || "#00d4ff");
    chip.title = a.status === "online" ? "Overlay OBS ouvert" : "Overlay OBS fermé : ne verra pas la vidéo";
    chip.innerHTML = `<span class="dot"></span>`;
    chip.append(a.id === me ? `${a.name} (moi)` : a.name);
    people.appendChild(chip);
  }
}
$("room-select").addEventListener("change", renderRoomBar);
$("room-join").addEventListener("click", async () => {
  const id = $<HTMLSelectElement>("room-select").value;
  if (!id) return;
  joinParty(me, id).catch(() => detect("err", "Impossible de rejoindre cette watch-party.", false));
});
$("room-leave").addEventListener("click", () => leaveParty(me).catch(() => {}));
$("party-new").addEventListener("click", async () => {
  const name = prompt("Nom de la nouvelle watch-party :", "Soirée vidéo");
  if (!name?.trim()) return;
  try {
    const id = await createParty(name, me);
    await joinParty(me, id);
  } catch {
    detect("err", "Création refusée.", false);
  }
});
armConfirmDelete(
  $<HTMLButtonElement>("party-delete"),
  () => {
    const id = $<HTMLSelectElement>("room-select").value;
    if (id) deleteParty(id).catch(() => detect("err", "Suppression refusée.", false));
  },
  "🗑",
);
$("room-share").addEventListener("click", async () => {
  if (!myRoom) return;
  const btn = $<HTMLButtonElement>("room-share");
  const url = appUrl(`voir.html?wp=${encodeURIComponent(myRoom)}`);
  try {
    await navigator.clipboard.writeText(url);
    btn.textContent = "Lien copié ✓";
  } catch {
    prompt("Copie ce lien et envoie-le à tes amis :", url);
  }
  setTimeout(() => (btn.textContent = "🔗 Lien spectateur"), 2000);
});

function enterRoom(room: string | null) {
  stopVideoWatch?.();
  stopVideoWatch = null;
  video = null;
  layer.setVideo(null);
  renderVideo();
  if (room) {
    stopVideoWatch = watchVideo(room, (v) => {
      video = v;
      layer.setVideo(v, v ? { color: actors[v.by]?.color, name: actors[v.by]?.name || v.by } : undefined);
      renderVideo();
    });
  }
}

// ---------- Vidéo en cours ----------

const fmt = (sec: number) => {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}` : `${m}:${String(r).padStart(2, "0")}`;
};

/** Réglages affichés : ceux de la vidéo en cours, sinon ceux du prochain lancement. */
const shown = (): LayoutPrefs => (video ? { cell: video.cell, width: video.width, style: video.style ?? "kos" } : prefs);

function renderLayout() {
  const l = shown();
  $("v-style").querySelectorAll<HTMLButtonElement>("button").forEach((b) => b.classList.toggle("on", b.dataset.style === l.style));
  $("v-sizes").querySelectorAll<HTMLButtonElement>("button").forEach((b) => b.classList.toggle("on", Number(b.dataset.w) === l.width));
  [...$("v-cells").children].forEach((b, i) => b.classList.toggle("on", i === l.cell));
  $("v-cells").style.opacity = l.width >= 1920 ? "0.35" : "";
  $("layout-note").textContent = video
    ? "Les changements s'appliquent en direct chez toute la watch-party."
    : "Réglages du prochain lancement.";
}

function renderVideo() {
  const has = !!video;
  $("transport").hidden = !has;
  const empty = $("empty-msg");
  empty.hidden = has;
  empty.textContent = !myRoom
    ? "Rejoins ou crée une watch-party (en haut) pour lancer ou voir une vidéo."
    : "Aucune vidéo pour l'instant. Colle un lien à droite pour en lancer une.";
  $<HTMLButtonElement>("video-go").disabled = !myRoom;
  renderLayout();
  if (!video) return;
  const clip = sourceOf(video) === "twitch-clip";
  $("v-title").textContent = video.title || SOURCE_LABELS[sourceOf(video)];
  $("v-by").textContent = `${SOURCE_LABELS[sourceOf(video)]} · lancée par ${actors[video.by]?.name || video.by}`;
  $("v-play").textContent = clip ? "↻ Rejouer" : video.state === "playing" ? "⏸ Pause" : "▶ Lecture";
  for (const id of ["v-back", "v-fwd", "v-seek"]) $(id).hidden = clip;
  $("clip-note").hidden = !clip;
}

// Barre de progression et titre, depuis le lecteur local.
let seeking = false;
setInterval(() => {
  if (!video) return;
  const t = layer.time();
  const pos = t.duration ? Math.min(t.current, t.duration) : expectedPosition(video, serverNow());
  $("v-time").textContent = `${fmt(pos)} / ${t.duration ? fmt(t.duration) : "--:--"}`;
  const seek = $<HTMLInputElement>("v-seek");
  if (!seeking && t.duration) {
    seek.max = String(Math.floor(t.duration));
    seek.value = String(Math.floor(pos));
  }
  if (!video.title && t.title && video.by === me && myRoom) setVideoTitle(myRoom, t.title).catch(() => {});
}, 500);

const now = () => (video ? expectedPosition(video, serverNow()) : 0);
const refused = () => detect("err", "Commande refusée : as-tu bien rejoint cette watch-party ?", false);
$("v-play").addEventListener("click", () => {
  if (!myRoom || !video) return;
  if (sourceOf(video) === "twitch-clip") return void controlVideo(myRoom, "playing", 0).catch(refused);
  controlVideo(myRoom, video.state === "playing" ? "paused" : "playing", now()).catch(refused);
});
$("v-back").addEventListener("click", () => myRoom && video && controlVideo(myRoom, video.state, now() - 10).catch(refused));
$("v-fwd").addEventListener("click", () => myRoom && video && controlVideo(myRoom, video.state, now() + 10).catch(refused));
const seekInput = $<HTMLInputElement>("v-seek");
seekInput.addEventListener("input", () => {
  seeking = true;
  $("v-time").textContent = `${fmt(Number(seekInput.value))} / ${fmt(Number(seekInput.max))}`;
});
seekInput.addEventListener("change", () => {
  seeking = false;
  if (myRoom && video) controlVideo(myRoom, video.state, Number(seekInput.value)).catch(refused);
});
armConfirmDelete($<HTMLButtonElement>("v-stop"), () => myRoom && stopVideo(myRoom).catch(refused), "■ Arrêter");

// ---------- Lancer ----------

const urlInput = $<HTMLInputElement>("video-url");
function updateDetect() {
  const raw = urlInput.value.trim();
  if (!raw) return detect("", myRoom ? "YouTube, Twitch ou fichier vidéo." : "Rejoins d'abord une watch-party.");
  const r = parseVideoLink(raw);
  if ("error" in r) detect("err", r.error);
  else detect("ok", `${SOURCE_LABELS[r.source]} reconnu ✓${r.start ? ` · départ à ${fmt(r.start)}` : ""}`);
}
urlInput.addEventListener("input", updateDetect);

$("video-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!myRoom) return detect("err", "Rejoins d'abord une watch-party.", false);
  const r = parseVideoLink(urlInput.value);
  if ("error" in r) return detect("err", r.error);
  const l = shown();
  try {
    await startVideo(myRoom, { source: r.source, videoId: r.id, by: me, position: r.start, cell: l.cell, width: l.width, style: l.style });
    urlInput.value = "";
    detect("ok", "Lancée pour toute la watch-party ✓", false);
  } catch {
    refused();
  }
});

// ---------- Affichage ----------

function changeLayout(patch: Partial<LayoutPrefs>) {
  prefs = { ...prefs, ...patch };
  savePrefs();
  if (video && myRoom) setVideoLayout(myRoom, patch).catch(refused);
  renderLayout();
}
for (const s of VIDEO_SIZES) {
  const b = document.createElement("button");
  b.dataset.w = String(s.width);
  b.textContent = s.label;
  b.title = s.width >= 1920 ? "Tout l'écran du stream" : `${s.width} px de large sur un stream 1080p`;
  $("v-sizes").appendChild(b);
}
$("v-sizes").addEventListener("click", (e) => {
  const w = (e.target as HTMLElement).closest("button")?.dataset.w;
  if (w) changeLayout({ width: Number(w) });
});
$("v-style").addEventListener("click", (e) => {
  const s = (e.target as HTMLElement).closest("button")?.dataset.style;
  if (s === "kos" || s === "plain") changeLayout({ style: s });
});
["Haut gauche", "Haut", "Haut droite", "Gauche", "Centre", "Droite", "Bas gauche", "Bas", "Bas droite"].forEach((title, i) => {
  const b = document.createElement("button");
  b.title = title;
  b.setAttribute("aria-label", title);
  b.addEventListener("click", () => changeLayout({ cell: i }));
  $("v-cells").appendChild(b);
});

// ---------- Son ----------

const volInput = $<HTMLInputElement>("v-volume");
watchVolume(me, (v) => {
  if (document.activeElement !== volInput) volInput.value = String(v);
  $("v-volume-out").textContent = `${v} %`;
  layer.setVolume(v);
});
volInput.addEventListener("input", () => ($("v-volume-out").textContent = `${volInput.value} %`));
volInput.addEventListener("change", () => setVolume(me, Number(volInput.value)));
$<HTMLInputElement>("v-listen").addEventListener("change", (e) => layer.setMuted(!(e.target as HTMLInputElement).checked));

// ---------- Données en direct ----------

watchActors((data) => {
  actors = data;
  renderRoomBar();
  if (video) {
    layer.setVideo(video, { color: actors[video.by]?.color, name: actors[video.by]?.name || video.by });
    renderVideo();
  }
});
let roomsLoaded = false;
function syncMyRoom() {
  let room = overlays[me!]?.party ?? null;
  if (room && roomsLoaded && !rooms[room]) room = null;
  if (room !== myRoom) {
    myRoom = room;
    enterRoom(myRoom);
    updateDetect();
  }
  renderRoomBar();
}
watchParties((data) => {
  rooms = data;
  roomsLoaded = true;
  syncMyRoom();
});
onValue(ref(db, "relog/overlay"), (snap) => {
  overlays = snap.val() ?? {};
  syncMyRoom();
});

renderVideo();
updateDetect();
