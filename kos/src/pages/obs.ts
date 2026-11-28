import "../theme.css";
import { requireMember, blockPage } from "../auth";
import { appUrl } from "../appUrl";
import { ObsClient } from "../obs/obsClient";
import { PART_INFO, WATCH_SCENE, applyPlan, defaultPlan, readState, retargetUrl, sceneThumbnail, type ObsState, type Part, type Plan, type SceneState } from "../obs/installer";

const member = await requireMember();
const me = member.actorId;
if (!me) {
  blockPage("Pas encore membre", "Ton compte n'est lié à aucun membre Re:log : demande une invitation à Kashiro.");
  throw new Error("no actor");
}

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const PORT_KEY = "kos.obs.port";

// ---------- Docks ----------

const u = encodeURIComponent(me);
const docks = [
  { name: "K-OS Installer", url: appUrl("obs.html") },
  { name: "K-OS Player", url: appUrl(`player.html?u=${u}`) },
  { name: "K-OS GIF", url: appUrl("relog.html") },
  { name: "K-OS Salons", url: appUrl("room.html") },
  { name: "K-OS Watch-party", url: appUrl("watch.html") },
];
for (const d of docks) {
  const row = document.createElement("div");
  row.className = "dock-row";
  row.innerHTML = `<b></b><input readonly /><button class="btn-sm">Copier</button>`;
  row.querySelector("b")!.textContent = d.name;
  const input = row.querySelector("input")!;
  input.value = d.url;
  input.setAttribute("aria-label", `Adresse du dock ${d.name}`);
  input.addEventListener("focus", () => input.select());
  const btn = row.querySelector("button")!;
  btn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(d.url);
      btn.textContent = "Copié ✓";
    } catch {
      input.select();
      btn.textContent = "Ctrl+C";
    }
    setTimeout(() => (btn.textContent = "Copier"), 1500);
  });
  $("docks").appendChild(row);
}

// ---------- Connexion ----------

const obs = new ObsClient();
const portInput = $<HTMLInputElement>("obs-port");
const passInput = $<HTMLInputElement>("obs-pass");
const connBtn = $<HTMLButtonElement>("obs-connect");
const connFb = $("conn-feedback");
try {
  portInput.value = localStorage.getItem(PORT_KEY) || "4455";
} catch {}

function feedback(el: HTMLElement, kind: "ok" | "err" | "", text: string) {
  el.className = `feedback ${kind}`.trim();
  el.textContent = text;
}

let state: ObsState | null = null;
let plan: Plan = {};
let showNested = false;

$("conn-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (obs.connected) {
    obs.close();
    return onDisconnected();
  }
  const port = Number(portInput.value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return feedback(connFb, "err", "Port invalide (par défaut : 4455).");
  connBtn.disabled = true;
  feedback(connFb, "", "Liaison avec OBS…");
  try {
    const { obsVersion } = await obs.connect(port, passInput.value);
    try {
      localStorage.setItem(PORT_KEY, String(port));
    } catch {}
    passInput.value = "";
    feedback(connFb, "ok", `Connecté à OBS ✓${obsVersion ? ` (WebSocket ${obsVersion})` : ""}`);
    connBtn.textContent = "Se déconnecter";
    $("step-connect").classList.add("done");
    await refresh();
  } catch (err) {
    feedback(connFb, "err", (err as Error).message);
  } finally {
    connBtn.disabled = false;
  }
});

obs.onClose = () => {
  onDisconnected();
  feedback(connFb, "err", "Liaison OBS perdue (OBS fermé ?). Relance la connexion.");
};

function onDisconnected() {
  connBtn.textContent = "Se connecter";
  $("step-connect").classList.remove("done");
  $("step-scenes").hidden = true;
  state = null;
}

// ---------- Scènes ----------

async function refresh() {
  try {
    state = await readState(obs, me!);
  } catch (err) {
    feedback($("apply-feedback"), "err", `Lecture d'OBS impossible : ${(err as Error).message}`);
    return;
  }
  plan = defaultPlan(state);
  $("step-scenes").hidden = false;
  const hasWatch = state.scenes.some((s) => s.name === WATCH_SCENE);
  $("watch-scene-opt").hidden = hasWatch;
  // Une scène « watch… » existe déjà (faite à la main) : on ne propose pas d'en créer une 2ᵉ par défaut.
  $<HTMLInputElement>("make-watch").checked = !state.scenes.some((s) => /watch/i.test(s.name));
  renderScenes();
}

// Miniatures des scènes (capture OBS), gardées entre deux rendus.
const thumbs = new Map<string, string>();
let thumbRun = 0;

async function loadThumbs(names: string[]) {
  const run = ++thumbRun;
  for (const name of names) {
    if (run !== thumbRun || !obs.connected) return;
    if (!thumbs.has(name)) {
      const url = await sceneThumbnail(obs, name);
      if (!url) continue;
      thumbs.set(name, url);
    }
    document.querySelectorAll<HTMLImageElement>(`.scard img[data-scene="${CSS.escape(name)}"]`).forEach((img) => {
      img.src = thumbs.get(name)!;
      img.closest(".thumb")?.classList.add("loaded");
    });
  }
}

const PART_ICON: Record<Part, string> = { relog: "💬", module: "🎮" };

function sceneCard(s: SceneState): HTMLElement {
  const card = document.createElement("article");
  card.className = `scard${s.kind === "nested" ? " nested" : ""}`;
  card.innerHTML = `
    <div class="thumb">
      <img alt="" />
      <span class="noimg">Aperçu…</span>
      <div class="ov-relog"><span>RE:LOG</span></div>
      <div class="ov-module"><i></i><i></i><i></i><i></i><i></i><i></i></div>
      <span class="badge"></span>
    </div>
    <div class="meta"><b class="nm"></b><small class="st"></small></div>
    <div class="tgs"></div>`;
  const img = card.querySelector("img")!;
  img.dataset.scene = s.name;
  if (thumbs.has(s.name)) {
    img.src = thumbs.get(s.name)!;
    card.querySelector(".thumb")!.classList.add("loaded");
  }
  card.querySelector(".nm")!.textContent = s.name;
  (card.querySelector(".nm") as HTMLElement).title = s.name;
  const tgs = card.querySelector(".tgs")!;
  for (const part of ["relog", "module"] as Part[]) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `tg ${part}`;
    b.dataset.part = part;
    b.innerHTML = `<span aria-hidden="true">${PART_ICON[part]}</span> ${PART_INFO[part].label}`;
    b.title = PART_INFO[part].hint;
    b.addEventListener("click", () => {
      plan[s.name][part] = !plan[s.name][part];
      updateCard(card, s);
      summarize();
    });
    tgs.appendChild(b);
  }
  updateCard(card, s);
  return card;
}

function updateCard(card: HTMLElement, s: SceneState) {
  const want = plan[s.name];
  let adds = 0, rems = 0;
  for (const part of ["relog", "module"] as Part[]) {
    const on = !!want?.[part], has = !!s.items[part];
    card.classList.toggle(`with-${part}`, on);
    const b = card.querySelector<HTMLButtonElement>(`.tg.${part}`)!;
    b.classList.toggle("on", on);
    b.classList.toggle("chg", on !== has);
    b.setAttribute("aria-pressed", String(on));
    b.setAttribute("aria-label", `${PART_INFO[part].label} dans ${s.name} : ${on ? "affiché" : "non affiché"}${on !== has ? " (changement en attente)" : ""}`);
    if (on && !has) adds++;
    if (!on && has) rems++;
  }
  card.classList.toggle("pending", adds + rems > 0);
  const badge = card.querySelector<HTMLElement>(".badge")!;
  badge.textContent = adds && rems ? "± à modifier" : adds ? "+ à ajouter" : rems ? "− à retirer" : "";
  badge.className = `badge${adds ? " add" : ""}${rems && !adds ? " rem" : ""}`;
  const st = card.querySelector<HTMLElement>(".st")!;
  const srcs = [s.items.relog?.sourceName, s.items.module?.sourceName].filter(Boolean);
  st.textContent = s.kind === "nested" ? "sous-scène" : srcs.length ? `dans OBS : ${srcs.join(", ")}` : "sans K-OS";
  st.title = st.textContent;
}

function renderScenes() {
  if (!state) return;
  const grid = $("scene-grid");
  grid.replaceChildren();
  const main = state.scenes.filter((s) => s.kind === "main");
  const nested = state.scenes.filter((s) => s.kind === "nested");
  // Une sous-scène déjà équipée reste visible pour qu'on la voie.
  const touched = (s: SceneState) => !!s.items.relog || !!s.items.module || !!plan[s.name]?.relog || !!plan[s.name]?.module;
  const shown = [...main, ...nested.filter((s) => showNested || touched(s))];
  for (const s of shown) grid.appendChild(sceneCard(s));
  const hiddenNested = nested.filter((s) => !showNested && !touched(s)).length;
  const toggle = $<HTMLButtonElement>("nested-toggle");
  toggle.hidden = !nested.length || (!showNested && !hiddenNested);
  toggle.textContent = showNested ? "▴ Masquer les sous-scènes" : `▾ Voir ${hiddenNested} sous-scène${hiddenNested > 1 ? "s" : ""}`;
  summarize();
  loadThumbs(shown.map((s) => s.name));
}
$("nested-toggle").addEventListener("click", () => {
  showNested = !showNested;
  renderScenes();
});

function summarize() {
  if (!state) return;
  let add = 0, rem = 0;
  for (const s of state.scenes)
    for (const part of ["relog", "module"] as Part[]) {
      const want = !!plan[s.name]?.[part], has = !!s.items[part];
      if (want && !has) add++;
      if (!want && has) rem++;
    }
  const makeWatch = !$("watch-scene-opt").hidden && $<HTMLInputElement>("make-watch").checked;
  const fix = state.inputs.relog.filter((i) => retargetUrl(i.url, "relog", true)).length;
  const parts = [
    add && `${add} ajout${add > 1 ? "s" : ""}`,
    rem && `${rem} retrait${rem > 1 ? "s" : ""}`,
    fix && `${fix} source Re:log séparée du module`,
    makeWatch && "1 scène créée",
  ].filter(Boolean);
  $("plan-summary").textContent = parts.length ? `À faire : ${parts.join(", ")}.` : "Tout est déjà en place.";
}
$("make-watch").addEventListener("change", summarize);

function setAll(part: Part, value: boolean) {
  // « Partout » = les scènes principales, pas les sous-scènes.
  for (const s of state?.scenes ?? []) if (s.kind === "main" || !value) plan[s.name][part] = value;
  renderScenes();
}
$("all-relog").addEventListener("click", () => setAll("relog", true));
$("none-relog").addEventListener("click", () => setAll("relog", false));
$("obs-refresh").addEventListener("click", () => {
  thumbs.clear();
  refresh();
});

$("obs-apply").addEventListener("click", async () => {
  if (!state) return;
  const btn = $<HTMLButtonElement>("obs-apply");
  const fb = $("apply-feedback");
  btn.disabled = true;
  try {
    const makeWatch = !$("watch-scene-opt").hidden && $<HTMLInputElement>("make-watch").checked;
    const res = await applyPlan(obs, me!, state, structuredClone(plan), {
      createWatchScene: makeWatch,
      onStep: (t) => feedback(fb, "", t),
    });
    const parts = [
      res.created.length && `scène « ${res.created.join(", ")} » créée`,
      res.added && `${res.added} source${res.added > 1 ? "s" : ""} ajoutée${res.added > 1 ? "s" : ""}`,
      res.removed && `${res.removed} retirée${res.removed > 1 ? "s" : ""}`,
      res.updated && `${res.updated} mise${res.updated > 1 ? "s" : ""} à jour`,
    ].filter(Boolean);
    await refresh();
    feedback(fb, "ok", parts.length ? `C'est fait ✓ ${parts.join(", ")}.` : "Rien à changer, tout était déjà en place ✓");
  } catch (err) {
    feedback(fb, "err", `OBS a refusé : ${(err as Error).message}`);
    await refresh();
  } finally {
    btn.disabled = false;
  }
});
