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

const targets = new Set<string>(loadTargets());

function loadTargets(): string[] {
  try {
    const list = JSON.parse(localStorage.getItem(TARGETS_KEY) || "[]");
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}
function saveTargets() {
  try {
    localStorage.setItem(TARGETS_KEY, JSON.stringify([...targets]));
  } catch {
    /* rien */
  }
}

const isMuted = (id: string) => overlays[id]?.muted === true;
const sendableTargets = () => [...targets].filter((id) => actors[id]?.name && !isMuted(id));

function status(kind: "ok" | "err" | "", text: string) {
  const el = $("status");
  el.className = `status ${kind}`;
  el.textContent = text;
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

  const all = document.createElement("span");
  all.className = `target all${allOn ? " on" : ""}`;
  all.innerHTML = `<span class="dot"></span>Tout le monde`;
  all.addEventListener("click", () => {
    if (allOn) available.forEach((a) => targets.delete(a.id));
    else available.forEach((a) => targets.add(a.id));
    saveTargets();
    renderTargets();
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
      renderTargets();
    });
    box.appendChild(chip);
  }
  updateSendButton();
}

// ---------- Choix du GIF ----------

const picker = mountGifPicker($("picker"), {
  me,
  onSelect: (gif) => {
    select(gif);
    status("", "");
  },
  onError: (msg) => status("err", msg),
});

function select(gif: GifMedia) {
  selected = gif;
  const thumb = $("sel-thumb");
  thumb.replaceChildren();
  thumb.style.backgroundImage = "";
  const src = gif.preview || gif.url;
  if (isVideoUrl(src)) {
    const v = document.createElement("video");
    Object.assign(v, { muted: true, autoplay: true, loop: true, playsInline: true, src });
    v.style.cssText = "width:100%;height:100%;object-fit:cover;border-radius:6px;";
    thumb.appendChild(v);
  } else {
    thumb.style.backgroundImage = `url("${src.replace(/"/g, "%22")}")`;
  }
  updateSendButton();
}

// ---------- Envoi ----------

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
    from: me!,
    fromName: self?.name || me!,
    color: self?.color || "#00d4ff",
    caption: $<HTMLInputElement>("caption").value.trim() || undefined,
  });
  pushRecent(gif);
  picker.refresh();
  pruneMySends(to, me!).catch(() => {});
}

$("send-btn").addEventListener("click", async () => {
  const to = sendableTargets();
  if (!selected || !to.length) return;
  cooldownUntil = Date.now() + COOLDOWN_MS;
  updateSendButton();
  setTimeout(updateSendButton, COOLDOWN_MS + 50);
  try {
    await send(to, selected);
    $<HTMLInputElement>("caption").value = "";
    status("ok", `Envoyé à ${to.map((id) => actors[id]?.name || id).join(", ")} ✓`);
  } catch {
    status("err", "Envoi refusé : la personne a peut-être coupé son overlay.");
  }
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
  $("muted-note").style.display = isMuted(me!) ? "block" : "none";
}

$("zone-h").addEventListener("input", (e) => ($("zone-h-out").textContent = `${(e.target as HTMLInputElement).value} px`));
$("zone-s").addEventListener("input", (e) => ($("zone-s-out").textContent = `${(e.target as HTMLInputElement).value} s`));
$("zone-h").addEventListener("change", (e) => setGifZone(me!, { height: Number((e.target as HTMLInputElement).value) }));
$("zone-s").addEventListener("change", (e) => setGifZone(me!, { seconds: Number((e.target as HTMLInputElement).value) }));
$("zone-test").addEventListener("click", async () => {
  const gif = selected || loadRecents()[0];
  if (!gif) return status("err", "Choisis d'abord un GIF (recherche, favori ou lien), puis teste.");
  if (isMuted(me!)) return status("err", "Ton overlay est coupé : réactive-le depuis ton player pour tester.");
  try {
    await send([me!], gif);
    status("ok", "GIF de test envoyé sur ton overlay ✓");
  } catch {
    status("err", "Test refusé.");
  }
});

// ---------- Données en direct ----------

watchActors((data) => {
  actors = data;
  renderTargets();
});
onValue(ref(db, "relog/overlay"), (snap) => {
  overlays = snap.val() ?? {};
  renderTargets();
  renderZone();
});

renderZone();
