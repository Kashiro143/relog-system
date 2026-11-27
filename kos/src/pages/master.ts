import "../theme.css";
import { watchActors, watchModes, setActorMode } from "../registry";
import type { Actor, ModuleDefinition } from "../types";
import { renderMasterSignalPanel } from "../modules/terminal/masterSignal";
import { renderPokemmoMasterPanel } from "../modules/pokemmo/masterPanel";
import { appUrl } from "../appUrl";
import { requireMember } from "../auth";
import { IDLE_MODE } from "../kernel";

await requireMember({ ownerOnly: true });

let selectedActorId: string | null = null;
let actors: Record<string, Actor> = {};
let modes: Record<string, ModuleDefinition> = {};
let panelCleanups: Array<() => void> = [];

const actorList = document.getElementById("actor-list")!;
const targetDisplay = document.getElementById("target-display")!;
const controlZone = document.getElementById("control-zone")!;
const linkHub = document.getElementById("link-hub")!;

function renderActorList() {
  actorList.innerHTML = Object.values(actors)
    .map(
      (a) => `
      <div class="actor-row ${selectedActorId === a.id ? "selected" : ""}" data-id="${a.id}">
        <span class="status-dot ${a.status}"></span>
        <div><strong>${a.name}</strong><br><small style="color:var(--text-dim)">${a.currentMode || "idle"}</small></div>
      </div>`,
    )
    .join("");

  actorList.querySelectorAll<HTMLDivElement>(".actor-row").forEach((row) => {
    row.addEventListener("click", () => selectActor(row.dataset.id!));
  });
}

function selectActor(id: string) {
  selectedActorId = id;
  targetDisplay.textContent = actors[id]?.name ?? id;
  renderActorList();
  renderControls();

  const u = encodeURIComponent(id);
  (document.getElementById("link-overlay") as HTMLInputElement).value = `${appUrl("overlay.html")}?u=${u}`;
  (document.getElementById("link-player") as HTMLInputElement).value = `${appUrl("player.html")}?u=${u}`;
  linkHub.style.display = "block";
}

function renderControls() {
  if (!selectedActorId) return;
  const actor = actors[selectedActorId];

  panelCleanups.forEach((fn) => fn());
  panelCleanups = [];

  const current = actor?.currentMode || IDLE_MODE;
  const modeButtons = Object.values(modes)
    .map(
      (m) =>
        `<button class="mode-btn ${current === m.id ? "active" : ""}" data-mode="${m.id}">${m.label}</button>`,
    )
    .join("");
  const idleButton = `<button class="mode-btn ${current === IDLE_MODE ? "active" : ""}" data-mode="${IDLE_MODE}" title="Masque le module sur l'overlay de ce membre">⏹ Aucun (masquer)</button>`;

  controlZone.innerHTML = `
    <div class="panel" style="margin-bottom:16px;">
      <h4>Module affiché</h4>
      ${modeButtons || '<p style="color:var(--text-dim)">Aucun mode : ajoute-en un dans la page Membres.</p>'}
      ${idleButton}
    </div>
    <div id="mode-panel" style="margin-bottom:16px;"></div>
    <div id="signal-panel"></div>`;

  controlZone.querySelectorAll<HTMLButtonElement>(".mode-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!selectedActorId) return;
      setActorMode(selectedActorId, btn.dataset.mode!);
    });
  });

  if (actor?.currentMode === "pokemmo") {
    panelCleanups.push(renderPokemmoMasterPanel(document.getElementById("mode-panel")!, selectedActorId));
  }

  panelCleanups.push(renderMasterSignalPanel(document.getElementById("signal-panel")!, selectedActorId));
}

document.querySelectorAll<HTMLButtonElement>("[data-copy]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const input = document.getElementById(btn.dataset.copy!) as HTMLInputElement;
    navigator.clipboard.writeText(input.value);
    const original = btn.textContent;
    btn.textContent = "✅";
    setTimeout(() => (btn.textContent = original), 1000);
  });
});

watchActors((data) => {
  actors = data;
  renderActorList();
  if (selectedActorId) renderControls();
});

watchModes((data) => {
  modes = data;
  if (selectedActorId) renderControls();
});
