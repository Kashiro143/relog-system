import "../theme.css";
import { ref, onValue } from "firebase/database";
import { db } from "../firebase";
import { watchActors, watchModes, setActorMode } from "../registry";
import type { Actor, ModuleDefinition } from "../types";
import { renderMasterSignalPanel } from "../modules/terminal/masterSignal";
import { renderPokemmoMasterPanel } from "../modules/pokemmo/masterPanel";
import { requireMember } from "../auth";
import { IDLE_MODE } from "../kernel";
import { panic, unmute } from "../relog/overlayControl";
import { watchRooms, type RoomMeta } from "../relog/room";
import { SOURCE_LABELS, sourceOf, watchVideo, type RoomVideo } from "../relog/watch";
import type { Unsubscribe } from "firebase/database";

const member = await requireMember({ ownerOnly: true });
const me = member.actorId;

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

let actors: Record<string, Actor> = {};
let modes: Record<string, ModuleDefinition> = {};
let overlays: Record<string, { room?: string; muted?: boolean }> = {};
let rooms: Record<string, RoomMeta> = {};
const videos = new Map<string, RoomVideo>();
const videoWatches = new Map<string, Unsubscribe>();
let connected = true;

/** Modules montrés dans les sélecteurs : « Aucun » puis ceux définis dans Membres. */
function modeOptions(): { id: string; label: string }[] {
  return [{ id: IDLE_MODE, label: "Aucun" }, ...Object.values(modes).map((m) => ({ id: m.id, label: m.label || m.id }))];
}
const modeOf = (a?: Actor) => a?.currentMode || IDLE_MODE;
const roomOf = (id: string) => overlays[id]?.room ?? null;
const sortedActors = () => Object.values(actors).sort((a, b) => (a.id === me ? -1 : b.id === me ? 1 : a.name.localeCompare(b.name)));

function modeSeg(current: string, onPick: (mode: string) => void, label: string): HTMLElement {
  const seg = document.createElement("div");
  seg.className = "seg";
  seg.setAttribute("role", "group");
  seg.setAttribute("aria-label", label);
  for (const o of modeOptions()) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = o.id === IDLE_MODE ? "⏹ Aucun" : o.label;
    b.className = `${current === o.id ? "on" : ""}${o.id === IDLE_MODE ? " idle" : ""}`.trim();
    b.setAttribute("aria-pressed", String(current === o.id));
    b.addEventListener("click", () => current !== o.id && onPick(o.id));
    seg.appendChild(b);
  }
  return seg;
}

// ---------- Voyants ----------

function tile(id: string, kind: "ok" | "warn" | "bad" | "", value: string, hint?: string) {
  const t = $(id);
  t.className = `tile ${kind}`.trim();
  t.querySelector("b")!.textContent = value;
  if (hint) t.title = hint;
}

function renderStatus() {
  tile("t-net", connected ? "ok" : "bad", connected ? "En ligne" : "Coupée", connected ? "Connecté à Firebase" : "Connexion perdue : les changements partiront au retour du réseau.");
  const list = Object.values(actors);
  const on = list.filter((a) => a.status === "online");
  tile("t-overlays", on.length ? "ok" : "warn", `${on.length} / ${list.length}`, on.map((a) => a.name).join(", ") || "Aucun overlay ouvert");
  const busy = Object.keys(rooms).filter((r) => list.some((a) => roomOf(a.id) === r));
  tile("t-rooms", busy.length ? "ok" : "", String(busy.length), busy.map((r) => rooms[r].name).join(", ") || "Personne dans un salon");
  const playing = [...videos.entries()].filter(([r]) => rooms[r]);
  tile("t-videos", playing.length ? "ok" : "", String(playing.length), playing.map(([r, v]) => `${rooms[r].name} : ${v.title || SOURCE_LABELS[sourceOf(v)]}`).join("\n") || "Aucune vidéo");
}

// ---------- Mon stream ----------

function renderMe() {
  const card = $("me-card");
  if (!me) {
    card.hidden = true;
    return;
  }
  const a = actors[me];
  const state = $("me-state");
  state.className = `tag push${a?.status === "online" ? " on" : ""}`;
  state.textContent = a?.status === "online" ? "● overlay ouvert" : "overlay fermé";
  $("me-mode").replaceChildren(modeSeg(modeOf(a), (m) => setActorMode(me, m), "Mon module"));
  const room = roomOf(me);
  const roomEl = $("me-room");
  roomEl.replaceChildren();
  if (room && rooms[room]) {
    const link = document.createElement("a");
    link.href = "room.html";
    link.textContent = rooms[room].name;
    roomEl.appendChild(link);
  } else roomEl.textContent = "aucun";
  const v = room ? videos.get(room) : undefined;
  $("me-video").textContent = v ? `${v.state === "playing" ? "▶" : "❚❚"} ${v.title || SOURCE_LABELS[sourceOf(v)]}` : "—";
  const muted = !!overlays[me]?.muted;
  const btn = $<HTMLButtonElement>("me-panic");
  btn.classList.toggle("muted", muted);
  btn.textContent = muted ? "▶ Réactiver mon overlay Re:log" : "🛑 Couper mon overlay Re:log";
  btn.title = muted ? "Les GIF, salons et signaux s'affichent de nouveau chez toi." : "Coupe d'un coup tout ce que les autres affichent chez toi.";
}
$("me-panic").addEventListener("click", () => {
  if (!me) return;
  (overlays[me]?.muted ? unmute(me) : panic(me)).catch(() => {});
});

// ---------- Modules du groupe ----------

function renderGroupRow() {
  const row = $("group-row");
  row.replaceChildren();
  const list = Object.values(actors);
  const lbl = document.createElement("span");
  lbl.className = "lbl";
  lbl.textContent = "Pour tout le groupe :";
  row.appendChild(lbl);
  const common = list.length && list.every((a) => modeOf(a) === modeOf(list[0])) ? modeOf(list[0]) : "";
  row.appendChild(modeSeg(common, (m) => void Promise.all(list.map((a) => setActorMode(a.id, m))).catch(() => {}), "Module pour tout le groupe"));
  if (!common && list.length) {
    const t = document.createElement("span");
    t.className = "tag";
    t.textContent = "réglages différents selon les membres";
    row.appendChild(t);
  }
}

/** Panneau de détail ouvert (un seul à la fois) : équipe PokeMMO d'un membre. */
let openDetail: { id: string; cleanup: () => void } | null = null;
const rows = new Map<string, HTMLElement>();

function closeDetail() {
  if (!openDetail) return;
  openDetail.cleanup();
  rows.get(openDetail.id)?.querySelector(".more")?.replaceChildren();
  openDetail = null;
}

function renderMembers() {
  const box = $("members");
  const list = sortedActors();
  if (!list.length) {
    box.innerHTML = `<p class="empty-note">Aucun membre : ajoute-en dans la page Membres.</p>`;
    return;
  }
  box.querySelector(".empty-note")?.remove();
  for (const [id, el] of rows)
    if (!actors[id]) {
      el.remove();
      rows.delete(id);
    }
  if (openDetail && (!actors[openDetail.id] || modeOf(actors[openDetail.id]) !== "pokemmo")) closeDetail();

  for (const a of list) {
    let el = rows.get(a.id);
    if (!el) {
      el = document.createElement("article");
      el.className = "member";
      el.innerHTML = `<div class="row"><div class="who"><span class="dot"></span><span class="nm"></span><span class="tags"></span></div><div class="ctl"></div><span class="extra"></span></div><div class="more"></div>`;
      rows.set(a.id, el);
    }
    box.appendChild(el); // garde l'ordre
    el.classList.toggle("online", a.status === "online");
    el.style.setProperty("--c", a.color || "#00d4ff");
    el.querySelector(".nm")!.textContent = a.id === me ? `${a.name} (toi)` : a.name;
    const tags = el.querySelector(".tags")!;
    tags.replaceChildren();
    const addTag = (text: string, cls = "") => {
      const t = document.createElement("span");
      t.className = `tag ${cls}`.trim();
      t.textContent = text;
      tags.appendChild(t);
    };
    addTag(a.status === "online" ? "en ligne" : "hors ligne", a.status === "online" ? "on" : "");
    const room = roomOf(a.id);
    if (room && rooms[room]) addTag(`🎨 ${rooms[room].name}`);
    if (overlays[a.id]?.muted) addTag("🛑 overlay coupé", "warn");
    el.querySelector(".ctl")!.replaceChildren(modeSeg(modeOf(a), (m) => setActorMode(a.id, m), `Module de ${a.name}`));

    const extra = el.querySelector(".extra")!;
    extra.replaceChildren();
    if (modeOf(a) === "pokemmo") {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "btn-sm";
      const open = openDetail?.id === a.id;
      b.textContent = open ? "▴ Équipe" : "▾ Équipe";
      b.title = "Voir et soigner l'équipe PokeMMO";
      b.setAttribute("aria-expanded", String(open));
      const row = el;
      b.addEventListener("click", () => {
        const wasOpen = openDetail?.id === a.id;
        closeDetail();
        if (!wasOpen) openDetail = { id: a.id, cleanup: renderPokemmoMasterPanel(row.querySelector<HTMLElement>(".more")!, a.id) };
        renderMembers();
      });
      extra.appendChild(b);
    }
  }
}

// ---------- Signaux ----------

let signalTarget = me ?? "";
let signalCleanup: (() => void) | null = null;

function renderSignalTarget() {
  const select = $<HTMLSelectElement>("signal-target");
  const list = sortedActors();
  if (!actors[signalTarget]) signalTarget = list[0]?.id ?? "";
  const key = list.map((a) => `${a.id}:${a.name}`).join("|");
  if (select.dataset.key !== key) {
    select.dataset.key = key;
    select.replaceChildren(
      ...list.map((a) => {
        const o = document.createElement("option");
        o.value = a.id;
        o.textContent = a.id === me ? `${a.name} (toi)` : a.name;
        return o;
      }),
    );
  }
  select.value = signalTarget;
  if (signalTarget && select.dataset.mounted !== signalTarget) mountSignal();
}
function mountSignal() {
  signalCleanup?.();
  $<HTMLSelectElement>("signal-target").dataset.mounted = signalTarget;
  signalCleanup = signalTarget ? renderMasterSignalPanel($("signal-zone"), signalTarget) : null;
}
$<HTMLSelectElement>("signal-target").addEventListener("change", (e) => {
  signalTarget = (e.target as HTMLSelectElement).value;
  mountSignal();
});

// ---------- Données ----------

function renderAll() {
  renderStatus();
  renderMe();
  renderGroupRow();
  renderMembers();
  renderSignalTarget();
}

watchActors((data) => {
  actors = data;
  renderAll();
});
watchModes((data) => {
  modes = data;
  renderAll();
});
onValue(ref(db, "relog/overlay"), (snap) => {
  overlays = snap.val() ?? {};
  renderAll();
});
watchRooms((data) => {
  rooms = data;
  // Une écoute de vidéo par salon existant (pas tout roomContent : les dessins y pèsent lourd).
  for (const [r, stop] of videoWatches)
    if (!rooms[r]) {
      stop();
      videoWatches.delete(r);
      videos.delete(r);
    }
  for (const r of Object.keys(rooms)) {
    if (videoWatches.has(r)) continue;
    videoWatches.set(
      r,
      watchVideo(r, (v) => {
        if (v) videos.set(r, v);
        else videos.delete(r);
        renderStatus();
        renderMe();
      }),
    );
  }
  renderAll();
});
onValue(ref(db, ".info/connected"), (snap) => {
  connected = snap.val() === true;
  renderStatus();
});
