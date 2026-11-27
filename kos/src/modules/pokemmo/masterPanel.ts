import { watchTeam, cycleSlotStatus, getRemainingTime, healAll, STATUS_LABELS } from "./data";
import type { Team, Order } from "./data";
import { staticSpriteUrl } from "./pokedex";

export function renderPokemmoMasterPanel(container: HTMLElement, actorId: string): () => void {
  container.innerHTML = `
    <style>
      .pkm-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 10px; margin-bottom: 14px; }
      .pkm-card { background: var(--panel-bg-alt); border: 1px solid var(--border); border-radius: 10px; padding: 10px; display: grid; justify-items: center; gap: 4px; }
      .pkm-card img { width: 56px; height: 56px; object-fit: contain; image-rendering: pixelated; }
      .pkm-card .nm { font-size: 13px; font-weight: 700; color: var(--accent-neon); max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .pkm-card .nm.empty-slot { color: var(--text-faint); }
      .pkm-card .pk-timer { font-family: var(--font-mono); font-size: 11px; color: var(--status-offline); min-height: 14px; }
      .pkm-card button { width: 100%; font-size: 10px; font-weight: 800; padding: 7px 4px; border-radius: 6px; border: 1px solid; }
      .pkm-card .st-0 { background: #00ff8822; color: #00ff88; border-color: #00ff88; }
      .pkm-card .st-1 { background: #ffa50022; color: #ffa500; border-color: #ffa500; }
      .pkm-card .st-2 { background: #ff450022; color: #ff4500; border-color: #ff4500; }
      .pkm-card .st-3 { background: #ff000022; color: #ff0000; border-color: #ff0000; }
    </style>
    <div class="panel">
      <h4>Équipe PokéMMO</h4>
      <div id="pkm-grid" class="pkm-grid"></div>
      <button id="pkm-heal" class="primary" style="width:100%;">✨ Soigner toute l'équipe</button>
    </div>
  `;

  const grid = container.querySelector<HTMLElement>("#pkm-grid")!;
  let currentTeam: Team = {};

  container.querySelector("#pkm-heal")!.addEventListener("click", () => healAll(actorId, currentTeam));

  function render(team: Team, order: Order) {
    currentTeam = team;
    grid.innerHTML = "";
    const sortedIds = [1, 2, 3, 4, 5, 6].sort((a, b) => (order[a] ?? a) - (order[b] ?? b));

    for (const id of sortedIds) {
      const slot = team[id];
      const status = slot?.status ?? 0;
      const div = document.createElement("div");
      div.className = "pkm-card";
      div.innerHTML = `
        <img src="${staticSpriteUrl(slot?.pokemonId ?? 0)}" alt="" />
        <div class="nm"></div>
        <div class="pk-timer">${getRemainingTime(slot)}</div>
        <button data-id="${id}" class="st-${status}" title="Changer le statut">${STATUS_LABELS[status]}</button>
      `;
      const nm = div.querySelector<HTMLElement>(".nm")!;
      nm.textContent = slot?.nickname || slot?.pokemonName || "Vide";
      nm.classList.toggle("empty-slot", !slot?.nickname && !slot?.pokemonName);
      div.querySelector("button")!.addEventListener("click", () => cycleSlotStatus(actorId, id));
      grid.appendChild(div);
    }
  }

  const unsubscribe = watchTeam(actorId, render);

  const timerInterval = setInterval(() => {
    grid.querySelectorAll<HTMLElement>(".pkm-card").forEach((card) => {
      const el = card.querySelector<HTMLElement>(".pk-timer")!;
      const id = Number(card.querySelector<HTMLElement>("button")!.dataset.id);
      el.textContent = getRemainingTime(currentTeam[id]);
    });
  }, 1000);

  return () => {
    unsubscribe();
    clearInterval(timerInterval);
  };
}
