import "../theme.css";
import { ref, onValue } from "firebase/database";
import { db } from "../firebase";
import { requireMember, blockPage } from "../auth";
import { watchActors } from "../registry";
import type { Actor } from "../types";
import { isVideoUrl, loadRecents, pruneMySends, pushRecent, sendGif, setGifZone, DEFAULT_ZONE, type GifMedia, type GifZone } from "../relog/gifs";
import { mountGifPicker } from "../relog/gifPicker";

const COOLDOWN_MS = 3000;
const TARGETS_KEY = "kos.gif.targets";
const MODE_KEY = "kos.gif.mode";
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const member = await requireMember();
const me = member.actorId;
if (!me) {
  blockPage("Membre non lié", "Ton adresse n'est liée à aucun membre Re:log : demande à Kashiro de t'inviter depuis la Forge.");
  throw new Error("[K-OS] membre non lié");
}

let actors: Record<string, Actor> = {};
let overlays: Record<string, { muted?: boolean; gifZone?: Partial<GifZone> }> = {};
let selected: GifMedia | null = null;
let cooldownUntil = 0;
let mode: "click" | "preview" = readLocal(MODE_KEY) === "preview" ? "preview" : "click";

const targets = new Set<string>(readTargets());

function readLocal(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeLocal(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* stockage indisponible */
  }
}
function readTargets(): string[] {
  try {
    const list = JSON.parse(readLocal(TARGETS_KEY) || "[]");
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

const isMuted = (id: string) => overlays[id]?.muted === true;
const sendableTargets = () => [...targets].filter((id) => actors[id]?.name && !isMuted(id));

let statusTimer: ReturnType<typeof setTimeout> | undefined;
function status(kind: "ok" | "err" | "", text: string) {
  const el = $("status");
  el.className = `status ${kind}`;
  el.textContent = text;
  clearTimeout(statusTimer);
  if (text) statusTimer = setTimeout(() => renderHelp(), 5000);
}

/** Rappel par défaut sous la barre d'envoi. */
function renderHelp() {
  const n = sendableTargets().length;
  const el = $("status");
  el.className = "status";
  el.textContent = !n
    ? "Choisis d'abord à qui envoyer."
    : mode === "click"
      ? `Clique sur un GIF pour l'envoyer à ${n > 1 ? `${n} personnes` : actors[sendableTargets()[0]]?.name ?? "1 personne"}.`
      : "Choisis un GIF, vérifie l'aperçu, puis Envoyer.";
}

// ---------- Destinataires ----------

function renderTargets() {
  const box = $("targets");
  box.replaceChildren();
  // Un nœud sans nom n'est pas un membre (ex : statut "en ligne" orphelin).
  const list = Object.values(actors)
    .filter((a) => a?.id && a.name)
    .sort((a, b) => (a.id === me ? -1 : b.id === me ? 1 : a.name.localeCompare(b.name)));
  const available = list.filter((a) => !isMuted(a.id));
  const allOn = available.length > 0 && available.every((a) => targets.has(a.id));

  const label = document.createElement("span");
  label.className = "label";
  label.textContent = "À";
  box.appendChild(label);

  const all = document.createElement("span");
  all.className = `target all${allOn ? " on" : ""}`;
  all.innerHTML = `<span class="dot"></span>Tout le monde`;
  all.addEventListener("click", () => {
    if (allOn) available.forEach((a) => targets.delete(a.id));
    else available.forEach((a) => targets.add(a.id));
    saveTargets();
  });
  box.appendChild(all);

  for (const a of list) {
    const chip = document.createElement("span");
    const muted = isMuted(a.id);
    chip.className = `target${a.status === "online" ? " online" : ""}${targets.has(a.id) && !muted ? " on" : ""}${muted ? " muted" : ""}`;
    chip.style.setProperty("--c", a.color || "#00d4ff");
    chip.title = muted ? `${a.name} a coupé son overlay Re:log` : a.status === "online" ? `${a.name} : overlay ouvert` : `${a.name} : overlay fermé`;
    const dot = document.createElement("span");
    dot.className = "dot";
    chip.append(dot, a.id === me ? `${a.name} (moi)` : a.name);
    chip.addEventListener("click", () => {
      if (muted) return;
      if (targets.has(a.id)) targets.delete(a.id);
      else targets.add(a.id);
      saveTargets();
    });
    box.appendChild(chip);
  }
  updateSendButton();
}

function saveTargets() {
  writeLocal(TARGETS_KEY, JSON.stringify([...targets]));
  renderTargets();
  renderHelp();
}

// ---------- Mode d'envoi ----------

function renderMode() {
  $("mode").querySelectorAll<HTMLButtonElement>("button").forEach((b) => b.classList.toggle("on", b.dataset.mode === mode));
  $("preview-bar").hidden = mode !== "preview";
  renderHelp();
}
$("mode").addEventListener("click", (e) => {
  const m = (e.target as HTMLElement).dataset.mode;
  if (m !== "click" && m !== "preview") return;
  mode = m;
  writeLocal(MODE_KEY, m);
  renderMode();
});

// ---------- Choix et envoi ----------

const picker = mountGifPicker($("picker"), {
  me,
  keepSelection: false,
  onPick: (gif) => (mode === "click" ? trySend(gif) : preview(gif)),
  onError: (msg) => status("err", msg),
});

function preview(gif: GifMedia) {
  selected = gif;
  const thumb = $("sel-thumb");
  thumb.replaceChildren();
  thumb.style.backgroundImage = "";
  const src = gif.preview || gif.url;
  if (isVideoUrl(src)) {
    const v = document.createElement("video");
    Object.assign(v, { muted: true, autoplay: true, loop: true, playsInline: true, src });
    thumb.appendChild(v);
  } else {
    thumb.style.backgroundImage = `url("${src.replace(/"/g, "%22")}")`;
  }
  $("sel-title").textContent = gif.title || (gif.sticker ? "Sticker" : "GIF");
  updateSendButton();
}

function updateSendButton() {
  const btn = $<HTMLButtonElement>("send-btn");
  const n = sendableTargets().length;
  btn.disabled = !selected || n === 0 || Date.now() < cooldownUntil;
  btn.textContent = n > 1 ? `Envoyer à ${n}` : "Envoyer";
}

async function send(to: string[], gif: GifMedia) {
  const self = actors[me!];
  await sendGif(to, {
    url: gif.url,
    preview: gif.preview,
    title: gif.title,
    sticker: gif.sticker,
    from: me!,
    fromName: self?.name || me!,
    color: self?.color || "#00d4ff",
    caption: $<HTMLInputElement>("caption").value.trim() || undefined,
  });
  pushRecent(gif);
  picker.refresh();
  pruneMySends(to, me!).catch(() => {});
}

async function trySend(gif: GifMedia) {
  const to = sendableTargets();
  if (!to.length) {
    status("err", "Choisis d'abord à qui envoyer.");
    picker.flash(gif.url, "À qui ?", true);
    const box = $("targets");
    box.classList.remove("pulse");
    void box.offsetWidth;
    box.classList.add("pulse");
    return;
  }
  const wait = cooldownUntil - Date.now();
  if (wait > 0) {
    picker.flash(gif.url, `Patiente ${Math.ceil(wait / 1000)} s`, true);
    return;
  }
  cooldownUntil = Date.now() + COOLDOWN_MS;
  updateSendButton();
  setTimeout(updateSendButton, COOLDOWN_MS + 50);
  try {
    await send(to, gif);
    $<HTMLInputElement>("caption").value = "";
    picker.flash(gif.url, "Envoyé ✓");
    status("ok", `Envoyé à ${to.map((id) => actors[id]?.name || id).join(", ")} ✓`);
  } catch {
    picker.flash(gif.url, "Refusé", true);
    status("err", "Envoi refusé : la personne a peut-être coupé son overlay.");
  }
}

$("send-btn").addEventListener("click", () => selected && trySend(selected));
$<HTMLInputElement>("caption").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && mode === "preview" && selected) trySend(selected);
});

// ---------- Mon overlay ----------

function renderZone() {
  const zone: GifZone = { ...DEFAULT_ZONE, ...overlays[me!]?.gifZone };
  const grid = $("zone-grid");
  if (!grid.children.length) {
    for (let i = 0; i < 9; i++) {
      const b = document.createElement("button");
      b.title = ["Haut gauche", "Haut", "Haut droite", "Gauche", "Centre", "Droite", "Bas gauche", "Bas", "Bas droite"][i];
      b.addEventListener("click", () => setGifZone(me!, { cell: i }));
      grid.appendChild(b);
    }
  }
  [...grid.children].forEach((b, i) => b.classList.toggle("on", i === zone.cell));
  const h = $<HTMLInputElement>("zone-h"), s = $<HTMLInputElement>("zone-s");
  if (document.activeElement !== h) h.value = String(zone.height);
  if (document.activeElement !== s) s.value = String(zone.seconds);
  $("zone-h-out").textContent = `${h.value} px`;
  $("zone-s-out").textContent = `${s.value} s`;
  $("muted-note").hidden = !isMuted(me!);
}

$("zone-h").addEventListener("input", (e) => ($("zone-h-out").textContent = `${(e.target as HTMLInputElement).value} px`));
$("zone-s").addEventListener("input", (e) => ($("zone-s-out").textContent = `${(e.target as HTMLInputElement).value} s`));
$("zone-h").addEventListener("change", (e) => setGifZone(me!, { height: Number((e.target as HTMLInputElement).value) }));
$("zone-s").addEventListener("change", (e) => setGifZone(me!, { seconds: Number((e.target as HTMLInputElement).value) }));
$("zone-test").addEventListener("click", async () => {
  const gif = selected || loadRecents()[0];
  if (!gif) return status("err", "Envoie ou choisis d'abord un GIF, puis teste.");
  if (isMuted(me!)) return status("err", "Ton overlay est coupé : réactive-le depuis ton player pour tester.");
  try {
    await send([me!], gif);
    status("ok", "GIF de test envoyé sur ton overlay ✓");
  } catch {
    status("err", "Test refusé.");
  }
});

// Réglages ouverts d'office sur grand écran, repliés dans un dock étroit.
($("overlay-panel") as HTMLDetailsElement).open = window.innerWidth >= 960;

// ---------- Données en direct ----------

watchActors((data) => {
  actors = data;
  renderTargets();
  renderHelp();
});
onValue(ref(db, "relog/overlay"), (snap) => {
  overlays = snap.val() ?? {};
  renderTargets();
  renderZone();
});

renderMode();
renderZone();
