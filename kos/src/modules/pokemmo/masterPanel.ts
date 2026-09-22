import { watchTeam, cycleSlotStatus, getRemainingTime, healAll, STATUS_LABELS } from "./data";
import type { Team, Order } from "./data";
import { staticSpriteUrl } from "./pokedex";

export function renderPokemmoMasterPanel(container: HTMLElement, actorId: string): () => void {
  container.innerHTML = `
    <div class="panel">
      <h4>Équipe PokéMMO</h4>
      <div id="pkm-grid" style="display:grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap:12px; margin-bottom:16px;"></div>
      <button id="pkm-heal" style="width:100%;">✨ Soigner toute l'équipe</button>
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
      div.style.cssText =
        "background: var(--panel-bg-alt); border: 1px solid var(--border); border-radius: 8px; padding: 10px; display: flex; flex-direction: column; align-items: center;";
      div.innerHTML = `
        <img src="${staticSpriteUrl(slot?.pokemonId ?? 0)}" style="width:56px; height:56px; object-fit:contain;" />
        <div style="font-size:0.8rem; font-weight:800; color:var(--accent-neon); margin:4px 0;">${slot?.nickname || slot?.pokemonName || "VIDE"}</div>
        <div class="pk-timer" style="font-family:var(--font-mono); font-size:0.75rem; color:var(--status-offline); height:16px;">${getRemainingTime(slot)}</div>
        <button data-id="${id}" style="width:100%; font-size:0.65rem; padding:6px;">${STATUS_LABELS[status]}</button>
      `;
      div.querySelector("button")!.addEventListener("click", () => cycleSlotStatus(actorId, id));
      grid.appendChild(div);
    }
  }

  const unsubscribe = watchTeam(actorId, render);

  const timerInterval = setInterval(() => {
    grid.querySelectorAll<HTMLElement>(".pk-timer").forEach((el, i) => {
      const id = i + 1;
      el.textContent = getRemainingTime(currentTeam[id]);
    });
  }, 1000);

  return () => {
    unsubscribe();
    clearInterval(timerInterval);
  };
}
