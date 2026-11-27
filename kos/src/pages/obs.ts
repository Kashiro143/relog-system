import "../theme.css";
import { requireMember, blockPage } from "../auth";
import { appUrl } from "../appUrl";
import { ObsClient } from "../obs/obsClient";
import { PART_INFO, WATCH_SCENE, applyPlan, defaultPlan, readState, retargetUrl, type ObsState, type Part, type Plan } from "../obs/installer";

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
  feedback(connFb, "", "Connexion à OBS…");
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
  feedback(connFb, "err", "Connexion à OBS perdue (OBS fermé ?). Reconnecte-toi.");
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

function renderScenes() {
  if (!state) return;
  const body = $("scene-rows");
  body.replaceChildren();
  const main = state.scenes.filter((s) => s.kind === "main");
  const nested = state.scenes.filter((s) => s.kind === "nested");
  // Une sous-scène déjà équipée ou modifiée reste visible pour qu'on la voie.
  const touched = (s: (typeof nested)[number]) => !!s.items.relog || !!s.items.module || !!plan[s.name]?.relog || !!plan[s.name]?.module;
  const rowsToShow = [...main, ...nested.filter((s) => showNested || touched(s))];
  const hiddenNested = nested.filter((s) => !showNested && !touched(s)).length;
  for (const s of rowsToShow) {
    const tr = document.createElement("tr");
    if (s.kind === "nested") tr.className = "nested";
    const name = document.createElement("td");
    name.textContent = s.name;
    tr.appendChild(name);
    for (const part of ["relog", "module"] as Part[]) {
      const td = document.createElement("td");
      td.className = "c";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = !!plan[s.name]?.[part];
      cb.setAttribute("aria-label", `${PART_INFO[part].label} dans ${s.name}`);
      cb.addEventListener("change", () => {
        plan[s.name][part] = cb.checked;
        renderScenes();
      });
      td.appendChild(cb);
      const has = s.items[part];
      const changed = cb.checked !== !!has;
      const note = document.createElement("span");
      note.className = `src${changed ? " chg" : ""}`;
      note.textContent = changed ? (cb.checked ? "+ à ajouter" : "− à retirer") : has ? has.sourceName : "";
      if (has) note.title = `Source : ${has.sourceName}`;
      td.appendChild(note);
      tr.appendChild(td);
    }
    body.appendChild(tr);
  }
  if (nested.length) {
    const tr = document.createElement("tr");
    tr.className = "toggle";
    const td = document.createElement("td");
    td.colSpan = 3;
    const btn = document.createElement("button");
    btn.className = "btn-sm";
    btn.textContent = showNested ? "▴ Masquer les sous-scènes" : `▾ ${hiddenNested} sous-scène${hiddenNested > 1 ? "s" : ""} masquée${hiddenNested > 1 ? "s" : ""}`;
    btn.title = "Scènes utilisées comme source dans d'autres scènes (Chanson, Alerte…) : le K-OS n'y est généralement pas utile.";
    btn.addEventListener("click", () => {
      showNested = !showNested;
      renderScenes();
    });
    td.appendChild(btn);
    tr.appendChild(td);
    if (showNested || hiddenNested) body.appendChild(tr);
  }
  summarize();
}

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
$("obs-refresh").addEventListener("click", () => refresh());

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
