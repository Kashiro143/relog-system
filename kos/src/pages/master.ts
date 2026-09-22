import "../theme.css";
import { watchActors, watchModes, setActorMode } from "../registry";
import type { Actor, ModuleDefinition } from "../types";
import { renderTerminalPanel } from "../modules/terminal/masterPanel";

let selectedActorId: string | null = null;
let actors: Record<string, Actor> = {};
let modes: Record<string, ModuleDefinition> = {};

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
  targetDisplay.textContent = id.toUpperCase();
  renderActorList();
  renderControls();

  const base = `${window.location.origin}`;
  (document.getElementById("link-overlay") as HTMLInputElement).value = `${base}/overlay.html?u=${id}`;
  (document.getElementById("link-player") as HTMLInputElement).value = `${base}/player.html?u=${id}`;
  linkHub.style.display = "block";
}

function renderControls() {
  if (!selectedActorId) return;
  const actor = actors[selectedActorId];

  const modeButtons = Object.values(modes)
    .map(
      (m) =>
        `<button class="mode-btn ${actor?.currentMode === m.id ? "active" : ""}" data-mode="${m.id}">${m.label}</button>`,
    )
    .join("");

  controlZone.innerHTML = `
    <div class="panel" style="margin-bottom:16px;">
      <h4>Univers actuel</h4>
      ${modeButtons || '<p style="color:var(--text-dim)">Aucun mode forgé — utilisez la Forge.</p>'}
    </div>
    <div id="module-controls"></div>`;

  controlZone.querySelectorAll<HTMLButtonElement>(".mode-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!selectedActorId) return;
      setActorMode(selectedActorId, btn.dataset.mode!);
    });
  });

  const moduleControls = document.getElementById("module-controls")!;
  if (actor?.currentMode === "terminal" && selectedActorId) {
    renderTerminalPanel(moduleControls, selectedActorId);
  }
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
