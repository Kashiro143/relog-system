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
      .pk-wrap { display: grid; gap: 14px; }
      .pk-head h1 { margin: 0; font-size: 18px; }
      .pk-head p { margin: 4px 0 0; }
      .pk-list { display: grid; gap: 8px; }
      .pk-slot { background: var(--panel-bg-alt); border: 1px solid var(--border); border-radius: 10px; padding: 8px 10px 8px 4px; display: flex; align-items: center; gap: 10px; }
      .pk-slot.sortable-ghost { opacity: 0.4; }
      .pk-handle { cursor: grab; color: var(--text-faint); font-size: 18px; padding: 8px 4px; user-select: none; line-height: 1; }
      .pk-handle:hover { color: var(--text-main); }
      .pk-slot img { width: 52px; height: 52px; flex: none; background: #000; border-radius: 8px; object-fit: contain; image-rendering: pixelated; }
      .pk-slot-inputs { flex: 1; min-width: 0; display: grid; gap: 4px; }
      .pk-slot-inputs input { width: 100%; padding: 5px 8px; font-size: 13px; }
      .pk-slot-inputs input.nickname { font-weight: 700; color: var(--accent-neon); }
      .pk-slot-inputs input.species { font-size: 12px; color: var(--text-dim); }
      .pk-slot .field-error { grid-column: 1 / -1; }
      .pk-status-col { display: grid; justify-items: center; gap: 3px; flex: none; }
      .pk-status-btn { width: 76px; padding: 8px 4px; border-radius: 6px; border: 1px solid; font-size: 10px; font-weight: 800; letter-spacing: 0.5px; }
      .pk-st-0 { background: #00ff8822; color: #00ff88; border-color: #00ff88; }
      .pk-st-1 { background: #ffa50022; color: #ffa500; border-color: #ffa500; }
      .pk-st-2 { background: #ff450022; color: #ff4500; border-color: #ff4500; }
      .pk-st-3 { background: #ff000022; color: #ff0000; border-color: #ff0000; }
      .pk-status-btn:hover { filter: brightness(1.25); }
      .pk-timer { font-size: 11px; font-weight: 700; color: var(--accent-neon); font-family: var(--font-mono); min-height: 14px; }
      .pk-settings { display: grid; gap: 12px; }
      .pk-settings input[type="range"] { width: 100%; }
      .pk-color-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
      .pk-color-grid input[type="color"] { width: 100%; height: 34px; border: 1px solid var(--border); background: transparent; cursor: pointer; }
    </style>
    <div class="pk-wrap">
      <header class="pk-head">
        <h1>🎮 Équipe PokéMMO</h1>
        <p class="hint">Glisse ⋮⋮ pour réordonner. Le bouton de statut tourne : En vie → 15 min → 30 min → Perma.</p>
      </header>
      <section class="panel" style="padding:12px;">
        <div class="pk-list" id="pk-list"></div>
      </section>
      <details class="panel" id="pk-settings-panel">
        <summary>Position et couleurs sur l'overlay</summary>
        <div class="pk-settings">
          <div class="field"><div class="field-row"><label class="field-label" for="pk-x">Position horizontale</label><output id="pk-x-out"></output></div><input type="range" id="pk-x" min="0" max="1920" /></div>
          <div class="field"><div class="field-row"><label class="field-label" for="pk-y">Position verticale</label><output id="pk-y-out"></output></div><input type="range" id="pk-y" min="0" max="1080" /></div>
          <div class="field"><div class="field-row"><label class="field-label" for="pk-s">Taille</label><output id="pk-s-out"></output></div><input type="range" id="pk-s" min="0.5" max="2" step="0.1" /></div>
          <div class="pk-color-grid">
            <div class="field"><label for="pk-color-neon">Couleur accent</label><input type="color" id="pk-color-neon" /></div>
            <div class="field"><label for="pk-color-text">Couleur texte</label><input type="color" id="pk-color-text" /></div>
          </div>
        </div>
      </details>
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
        <span class="pk-handle" title="Glisser pour réordonner" aria-hidden="true">⋮⋮</span>
        <img src="${staticSpriteUrl(slot?.pokemonId ?? 0)}" alt="" data-role="sprite" />
        <div class="pk-slot-inputs">
          <input type="text" class="nickname" placeholder="Surnom" aria-label="Surnom, emplacement ${id}" data-role="nickname" />
          <input type="text" class="species" placeholder="Espèce (ex : Dracaufeu)" aria-label="Espèce, emplacement ${id}" data-role="species" />
        </div>
        <div class="pk-status-col">
          <button class="pk-status-btn pk-st-${status}" data-role="status" title="Changer le statut">${STATUS_LABELS[status]}</button>
          <div class="pk-timer" data-role="timer">${getRemainingTime(slot)}</div>
        </div>`;
      div.querySelector<HTMLInputElement>('[data-role="nickname"]')!.value = slot?.nickname ?? "";
      div.querySelector<HTMLInputElement>('[data-role="species"]')!.value = slot?.pokemonName ?? "";
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
          flashError(div.querySelector<HTMLElement>(".pk-slot-inputs")!, err instanceof Error ? err.message : "Erreur de recherche.");
        }
      });

      div.querySelector<HTMLButtonElement>('[data-role="status"]')!.addEventListener("click", () => {
        cycleSlotStatus(actorId, id);
      });
    }

    sortable?.destroy();
    sortable = Sortable.create(list, {
      animation: 150,
      handle: ".pk-handle",
      onEnd: () => {
        const newOrder: Order = {};
        list.querySelectorAll<HTMLElement>(".pk-slot").forEach((el, i) => {
          newOrder[Number(el.dataset.id)] = i;
        });
        setOrder(actorId, newOrder);
      },
    });
  }

  const outputs = () => {
    container.querySelector("#pk-x-out")!.textContent = `${xRange.value} px`;
    container.querySelector("#pk-y-out")!.textContent = `${yRange.value} px`;
    container.querySelector("#pk-s-out")!.textContent = `× ${Number(sRange.value).toFixed(1)}`;
  };
  xRange.addEventListener("input", () => (outputs(), updateLayout(actorId, { x: Number(xRange.value) })));
  yRange.addEventListener("input", () => (outputs(), updateLayout(actorId, { y: Number(yRange.value) })));
  sRange.addEventListener("input", () => (outputs(), updateLayout(actorId, { s: Number(sRange.value) })));
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
    outputs();
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
