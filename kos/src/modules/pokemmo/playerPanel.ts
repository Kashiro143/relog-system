import Sortable from "sortablejs";
import {
  watchTeam,
  watchLayout,
  setOrder,
  updateLayout,
  updateSlotFields,
  cycleSlotStatus,
  checkAutoRevive,
  getRemainingTime,
  STATUS_LABELS,
} from "./data";
import type { Team, Order, Layout } from "./data";
import { searchPokemonByName, staticSpriteUrl } from "./pokedex";
import { flashError } from "../../ui/dialogs";

export function mountPokemmoPlayer(container: HTMLElement, actorId: string) {
  container.innerHTML = `
    <style>
      .pk-slot { background: var(--panel-bg-alt); border: 1px solid var(--border); border-radius: 12px; padding: 12px; display: flex; align-items: center; gap: 15px; cursor: grab; position: relative; margin-bottom: 12px; }
      .pk-slot img { width: 60px; height: 60px; background: #000; border-radius: 8px; object-fit: contain; }
      .pk-slot-inputs { flex: 1; display: flex; flex-direction: column; gap: 5px; }
      .pk-slot-inputs input { background: rgba(255,255,255,0.05); border: none; border-radius: 4px; color: var(--text-main); padding: 6px 10px; font-size: 13px; }
      .pk-slot-inputs input.nickname { font-weight: bold; color: var(--accent-neon); border-bottom: 1px solid var(--border); }
      .pk-status-col { display: flex; flex-direction: column; align-items: center; min-width: 80px; gap: 4px; }
      .pk-status-btn { width: 80px; padding: 10px 5px; border-radius: 6px; border: 1px solid; font-size: 10px; font-weight: 800; cursor: pointer; }
      .pk-st-0 { background: #00ff8822; color: #00ff88; border-color: #00ff88; }
      .pk-st-1 { background: #ffa50022; color: #ffa500; border-color: #ffa500; }
      .pk-st-2 { background: #ff450022; color: #ff4500; border-color: #ff4500; }
      .pk-st-3 { background: #ff000022; color: #ff0000; border-color: #ff0000; }
      .pk-timer { font-size: 11px; font-weight: bold; color: var(--accent-neon); font-family: var(--font-mono); }
      .pk-layout-row { display: flex; flex-direction: column; gap: 4px; margin-bottom: 14px; }
      .pk-layout-row label { font-size: 0.7rem; color: var(--text-dim); text-transform: uppercase; }
      .pk-color-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
      .pk-color-grid input[type="color"] { width: 100%; height: 36px; border: none; background: transparent; cursor: pointer; }
    </style>
    <div class="panel" style="margin-bottom: 16px;">
      <h4>Équipe (glisser pour réordonner)</h4>
      <div id="pk-list"></div>
    </div>
    <div class="panel">
      <h4>Réglages overlay</h4>
      <div class="pk-layout-row"><label>Position X</label><input type="range" id="pk-x" min="0" max="1920" /></div>
      <div class="pk-layout-row"><label>Position Y</label><input type="range" id="pk-y" min="0" max="1080" /></div>
      <div class="pk-layout-row"><label>Taille</label><input type="range" id="pk-s" min="0.5" max="2" step="0.1" /></div>
      <div class="pk-color-grid">
        <div><label style="font-size:0.7rem; color:var(--text-dim);">Couleur accent</label><input type="color" id="pk-color-neon" /></div>
        <div><label style="font-size:0.7rem; color:var(--text-dim);">Couleur texte</label><input type="color" id="pk-color-text" /></div>
      </div>
    </div>
  `;

  const list = container.querySelector<HTMLElement>("#pk-list")!;
  const xRange = container.querySelector<HTMLInputElement>("#pk-x")!;
  const yRange = container.querySelector<HTMLInputElement>("#pk-y")!;
  const sRange = container.querySelector<HTMLInputElement>("#pk-s")!;
  const neonColor = container.querySelector<HTMLInputElement>("#pk-color-neon")!;
  const textColor = container.querySelector<HTMLInputElement>("#pk-color-text")!;

  let currentTeam: Team = {};
  let sortable: Sortable | null = null;

  function render(team: Team, order: Order) {
    currentTeam = team;
    list.innerHTML = "";
    const sortedIds = [1, 2, 3, 4, 5, 6].sort((a, b) => (order[a] ?? a) - (order[b] ?? b));

    for (const id of sortedIds) {
      const slot = team[id];
      const status = slot?.status ?? 0;
      const div = document.createElement("div");
      div.className = "pk-slot";
      div.dataset.id = String(id);
      div.innerHTML = `
        <img src="${staticSpriteUrl(slot?.pokemonId ?? 0)}" data-role="sprite" />
        <div class="pk-slot-inputs">
          <input type="text" class="nickname" placeholder="Surnom" value="${slot?.nickname ?? ""}" data-role="nickname" />
          <input type="text" placeholder="Espèce (ex: Dracaufeu)" value="${slot?.pokemonName ?? ""}" data-role="species" />
        </div>
        <div class="pk-status-col">
          <button class="pk-status-btn pk-st-${status}" data-role="status">${STATUS_LABELS[status]}</button>
          <div class="pk-timer" data-role="timer">${getRemainingTime(slot)}</div>
        </div>`;
      list.appendChild(div);

      div.querySelector<HTMLInputElement>('[data-role="nickname"]')!.addEventListener("change", (e) => {
        updateSlotFields(actorId, id, { nickname: (e.target as HTMLInputElement).value });
      });

      div.querySelector<HTMLInputElement>('[data-role="species"]')!.addEventListener("change", async (e) => {
        const value = (e.target as HTMLInputElement).value;
        if (!value.trim()) return;
        try {
          const result = await searchPokemonByName(value);
          await updateSlotFields(actorId, id, {
            pokemonId: result.id,
            pokemonName: value,
            status: 0,
            history: 0,
            timestamp: null,
          });
        } catch (err) {
          flashError(div, err instanceof Error ? err.message : "Erreur de recherche.");
        }
      });

      div.querySelector<HTMLButtonElement>('[data-role="status"]')!.addEventListener("click", () => {
        cycleSlotStatus(actorId, id);
      });
    }

    sortable?.destroy();
    sortable = Sortable.create(list, {
      animation: 150,
      onEnd: () => {
        const newOrder: Order = {};
        list.querySelectorAll<HTMLElement>(".pk-slot").forEach((el, i) => {
          newOrder[Number(el.dataset.id)] = i;
        });
        setOrder(actorId, newOrder);
      },
    });
  }

  xRange.addEventListener("input", () => updateLayout(actorId, { x: Number(xRange.value) }));
  yRange.addEventListener("input", () => updateLayout(actorId, { y: Number(yRange.value) }));
  sRange.addEventListener("input", () => updateLayout(actorId, { s: Number(sRange.value) }));
  neonColor.addEventListener("input", () => updateLayout(actorId, { colorNeon: neonColor.value }));
  textColor.addEventListener("input", () => updateLayout(actorId, { colorText: textColor.value }));

  let layoutLoaded = false;
  watchLayout(actorId, (layout: Layout) => {
    if (layoutLoaded) return; // évite d'écraser le curseur pendant que l'utilisateur le déplace
    layoutLoaded = true;
    xRange.value = String(layout.x);
    yRange.value = String(layout.y);
    sRange.value = String(layout.s);
    neonColor.value = layout.colorNeon;
    textColor.value = layout.colorText;
  });

  watchTeam(actorId, render);

  setInterval(() => {
    checkAutoRevive(actorId, currentTeam);
    list.querySelectorAll<HTMLElement>(".pk-slot").forEach((el) => {
      const id = Number(el.dataset.id);
      const timerEl = el.querySelector<HTMLElement>('[data-role="timer"]');
      if (timerEl) timerEl.textContent = getRemainingTime(currentTeam[id]);
    });
  }, 1000);
}
