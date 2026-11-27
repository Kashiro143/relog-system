import "../theme.css";
import { ref, onValue } from "firebase/database";
import { db } from "../firebase";
import { watchActors } from "../registry";
import type { Actor } from "../types";
import { watchRooms, watchStrokes, watchItems, watchCursors } from "../relog/room";
import { createRoomView } from "../relog/roomView";
import { createVideoLayer } from "../relog/videoLayer";
import { SOURCE_LABELS, sourceOf, watchVideo } from "../relog/watch";

// Page spectateur, sans compte : un ami qui ne streame pas suit la watch-party
// d'un salon (vidéo synchronisée + dessins / GIF du salon). Lecture seule.

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const VOL_KEY = "kos.voir.volume";
const roomId = new URLSearchParams(location.search).get("salon") ?? "";

const stage = $("stage");
const layer = createVideoLayer($("video-root"), { muted: true });
const view = createRoomView($("room-root"));

let actors: Record<string, Actor> = {};
let overlays: Record<string, { room?: string }> = {};
let roomName = "";
let muted = true;
let volume = 80;
try {
  volume = Math.max(0, Math.min(100, Number(localStorage.getItem(VOL_KEY) ?? 80)));
} catch {}
$<HTMLInputElement>("volume").value = String(volume);

function wait(text: string | null) {
  $("wait").hidden = text === null;
  if (text !== null) $("wait-text").textContent = text;
}

if (!/^[A-Za-z0-9_-]{1,40}$/.test(roomId)) {
  wait("Lien incomplet : demande le lien de la watch-party à un streamer du salon.");
} else {
  start();
}

function applyAudio() {
  layer.setMuted(muted);
  layer.setVolume(volume);
  $("mute").textContent = muted ? "🔇" : "🔊";
  $("sound-cta").hidden = !muted || $("wait").hidden === false;
}

function start() {
  watchActors((data) => {
    actors = data;
    renderPeople();
  });
  onValue(ref(db, "relog/overlay"), (snap) => {
    overlays = snap.val() ?? {};
    renderPeople();
  });
  watchRooms((rooms) => {
    const r = rooms[roomId];
    if (!r) {
      roomName = "";
      $("room-name").textContent = "";
      wait("Ce salon n'existe plus. Demande un nouveau lien aux streamers.");
      layer.setVideo(null);
      return;
    }
    roomName = r.name;
    $("room-name").textContent = r.name;
    document.title = `${r.name} · K-OS Watch-party`;
  });
  watchStrokes(roomId, (m) => view.setStrokes(m));
  watchItems(roomId, (m) => view.setItems(m));
  watchCursors(roomId, (c) => view.setCursors(c));
  watchVideo(roomId, (v) => {
    if (!v) {
      layer.setVideo(null);
      $("v-title").textContent = "";
      $("v-sub").textContent = "";
      wait(roomName ? "Aucune vidéo pour l'instant : elle apparaîtra ici dès qu'un streamer en lance une." : "Connexion au salon…");
      applyAudio();
      return;
    }
    wait(null);
    // Ici la vidéo prend toute la scène, quelle que soit la taille choisie pour les streams.
    layer.setVideo({ ...v, width: 1920, cell: 4 }, { color: actors[v.by]?.color, name: actors[v.by]?.name || v.by });
    $("v-title").textContent = v.title || SOURCE_LABELS[sourceOf(v)];
    $("v-sub").textContent = `Lancée par ${actors[v.by]?.name || v.by}${v.state === "playing" ? "" : " · en pause"}`;
    applyAudio();
  });
}

function renderPeople() {
  const box = $("people");
  box.replaceChildren();
  for (const [id, o] of Object.entries(overlays)) {
    if (o?.room !== roomId) continue;
    const a = actors[id];
    const chip = document.createElement("span");
    const online = a?.status === "online";
    chip.className = `person${online ? "" : " off"}`;
    chip.style.setProperty("--c", a?.color || "#00d4ff");
    chip.title = online ? "En live / overlay ouvert" : "Overlay fermé";
    chip.innerHTML = `<span class="dot"></span><span class="n"></span>`;
    chip.querySelector(".n")!.textContent = a?.name || id;
    box.appendChild(chip);
  }
}

// ---------- Son et plein écran ----------

// Les navigateurs bloquent le son tant qu'on n'a pas cliqué : on démarre muet.
$("sound-cta").addEventListener("click", () => {
  muted = false;
  applyAudio();
});
$("mute").addEventListener("click", () => {
  muted = !muted;
  applyAudio();
});
$<HTMLInputElement>("volume").addEventListener("input", (e) => {
  volume = Number((e.target as HTMLInputElement).value);
  if (volume > 0) muted = false;
  try {
    localStorage.setItem(VOL_KEY, String(volume));
  } catch {}
  applyAudio();
});
$("fs").addEventListener("click", () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else stage.requestFullscreen?.();
});
applyAudio();
