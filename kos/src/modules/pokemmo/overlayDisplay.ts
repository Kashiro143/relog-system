import { watchTeam, watchLayout } from "./data";
import type { Team, Order } from "./data";
import { animatedSpriteUrl, staticSpriteUrl } from "./pokedex";

const STYLE = `
.kos-pkmn-root { position: absolute; display: flex; flex-direction: column; gap: 8px; transition: all 0.3s cubic-bezier(0.18, 0.89, 0.32, 1.28); transform-origin: top left; }

.kos-pkmn-card { width: 260px; height: 60px; background: rgba(10, 11, 13, 0.9); border-left: 4px solid var(--pkmn-neon, #00d4ff); display: flex; align-items: center; padding: 0 10px; color: var(--pkmn-text, #fff); border-radius: 0 8px 8px 0; box-shadow: 4px 4px 10px rgba(0,0,0,0.5); position: relative; overflow: hidden; }

.kos-pkmn-img { width: 55px; height: 55px; object-fit: contain; filter: drop-shadow(0 0 3px var(--pkmn-neon, #00d4ff)); z-index: 2; margin-right: 5px; animation: kosPkmnPulse 3s infinite ease-in-out; }
.kos-pkmn-img.glitch { animation: kosPkmnGlitch 0.3s ease-in-out; }

@keyframes kosPkmnPulse { 0%, 100% { transform: scale(1) translateY(0); } 50% { transform: scale(1.05) translateY(-1px); } }
@keyframes kosPkmnGlitch {
  0% { transform: translate(2px,2px); filter: hue-rotate(90deg) brightness(1.5); }
  50% { transform: translate(-3px,-1px); filter: contrast(2); }
  100% { transform: translate(0); filter: none; }
}

.kos-pkmn-info { flex: 1; display: flex; flex-direction: column; justify-content: center; margin-left: 10px; min-width: 0; z-index: 2; }
.kos-pkmn-name { font-weight: 800; font-size: 16px; text-transform: uppercase; color: var(--pkmn-text, #fff) !important; line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 130px; }
.kos-pkmn-sub { font-size: 10px; opacity: 0.7; font-style: italic; color: var(--pkmn-text, #fff) !important; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.kos-pkmn-card.status-1 { border-left-color: #ffa500 !important; }
.kos-pkmn-card.status-1 .kos-pkmn-img { filter: grayscale(0.7) sepia(1) hue-rotate(15deg); opacity: 0.8; }
.kos-pkmn-card.status-1::after { content: "15 MIN"; color: #ffa500; border: 1px solid #ffa500; }

.kos-pkmn-card.status-2 { border-left-color: #ff4500 !important; }
.kos-pkmn-card.status-2 .kos-pkmn-img { filter: grayscale(0.7) sepia(1) hue-rotate(330deg); opacity: 0.8; }
.kos-pkmn-card.status-2::after { content: "30 MIN"; color: #ff4500; border: 1px solid #ff4500; }

.kos-pkmn-card.status-3 { border-left-color: #ff0000 !important; background: rgba(30, 0, 0, 0.9) !important; }
.kos-pkmn-card.status-3 .kos-pkmn-img { filter: grayscale(1) brightness(0.4); }
.kos-pkmn-card.status-3 .kos-pkmn-name { color: #666 !important; }
.kos-pkmn-card.status-3::after { content: "DÉCÉDÉ"; color: #ff0000; border: 1px solid #ff0000; }

.kos-pkmn-card[class*="status-"]::after { position: absolute; right: 8px; top: 50%; transform: translateY(-50%); font-size: 10px; font-weight: 900; padding: 2px 4px; border-radius: 3px; background: rgba(0, 0, 0, 0.6); z-index: 5; }
`;

function injectStyleOnce() {
  if (document.getElementById("kos-pkmn-style")) return;
  const style = document.createElement("style");
  style.id = "kos-pkmn-style";
  style.textContent = STYLE;
  document.head.appendChild(style);
}

export function mountPokemmoOverlay(root: HTMLElement, actorId: string) {
  injectStyleOnce();
  root.classList.add("kos-pkmn-root");

  let prevTeam: Team = {};

  watchLayout(actorId, (layout) => {
    root.style.left = `${layout.x}px`;
    root.style.top = `${layout.y}px`;
    root.style.transform = `scale(${layout.s})`;
    root.style.setProperty("--pkmn-neon", layout.colorNeon);
    root.style.setProperty("--pkmn-text", layout.colorText);
  });

  watchTeam(actorId, (team, order) => render(team, order));

  function render(team: Team, order: Order) {
    root.innerHTML = "";
    const sortedIds = [1, 2, 3, 4, 5, 6].sort((a, b) => (order[a] ?? a) - (order[b] ?? b));

    for (const id of sortedIds) {
      const slot = team[id];
      if (!slot || (!slot.pokemonId && !slot.nickname)) continue;

      const prevStatus = prevTeam[id]?.status ?? 0;
      const shouldGlitch = slot.status !== prevStatus && slot.status !== 0;

      const card = document.createElement("div");
      card.className = `kos-pkmn-card status-${slot.status}`;
      card.innerHTML = `
        <img src="${animatedSpriteUrl(slot.pokemonId)}" class="kos-pkmn-img ${shouldGlitch ? "glitch" : ""}"
             onerror="this.src='${staticSpriteUrl(slot.pokemonId)}'">
        <div class="kos-pkmn-info">
          <div class="kos-pkmn-name">${slot.nickname || slot.pokemonName || "???"}</div>
          <div class="kos-pkmn-sub">${slot.nickname ? slot.pokemonName : ""}</div>
        </div>`;
      root.appendChild(card);
    }

    prevTeam = JSON.parse(JSON.stringify(team));
  }
}
