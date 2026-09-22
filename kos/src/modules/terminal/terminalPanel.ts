import { watchArchives, dispatchLive, resetLive } from "./data";
import type { Archive, Skin } from "./data";
import { renderArchiveLibrary } from "./archiveLibrary";

const ACTOR_ID = "Kashiro";

/** Page dédiée de Kashiro : bibliothèque (éditable) + boucle "starting soon" + envoi rapide sur son propre overlay. */
export function renderTerminalPanel(container: HTMLElement) {
  let archives: Record<string, Archive> = {};
  let queue: string[] = [];
  let skin: Skin = "classic";
  let isLooping = false;
  let isRunning = false;
  let runToken = 0;

  container.innerHTML = `
    <div class="panel" style="margin-bottom:16px;">
      <h4>Message rapide (sur mon overlay)</h4>
      <textarea id="term-quick-text" placeholder="Message à injecter en direct..." rows="3" style="width:100%; margin-bottom:8px; font-family:var(--font-mono); background:#000; color:var(--text-main); border:1px solid var(--border); border-radius:4px; padding:8px;"></textarea>
      <label style="font-size:0.8rem; display:flex; align-items:center; gap:6px; margin-bottom:10px;">
        <input type="checkbox" id="term-quick-raid" /> Mode RAID (glitch)
      </label>
      <button id="term-quick-send" style="width:100%;">Envoyer</button>
    </div>

    <div class="panel" style="margin-bottom:16px;">
      <h4>Archives (lore) — bibliothèque partagée</h4>
      <div id="term-archive-lib"></div>
    </div>

    <div class="panel">
      <h4>Séquenceur — boucle "Starting soon"</h4>
      <div id="term-queue" style="min-height:40px; border:1px solid var(--border); border-radius:4px; padding:8px; margin-bottom:10px;"></div>
      <div style="display:flex; gap:8px; flex-wrap:wrap;">
        <button id="term-play">▶ Lancer</button>
        <button id="term-stop">■ Stop</button>
        <button id="term-loop">Boucle : OFF</button>
        <select id="term-skin" style="margin-left:auto;">
          <option value="classic">Skin : Classique</option>
          <option value="techwear">Skin : Techwear</option>
        </select>
      </div>
      <button id="term-reset" style="width:100%; margin-top:10px; color:var(--status-offline); border-color:var(--status-offline);">Effacer l'écran</button>
    </div>
  `;

  const quickText = container.querySelector<HTMLTextAreaElement>("#term-quick-text")!;
  const quickRaid = container.querySelector<HTMLInputElement>("#term-quick-raid")!;
  const queueList = container.querySelector<HTMLElement>("#term-queue")!;
  const playBtn = container.querySelector<HTMLButtonElement>("#term-play")!;
  const loopBtn = container.querySelector<HTMLButtonElement>("#term-loop")!;
  const skinSelect = container.querySelector<HTMLSelectElement>("#term-skin")!;

  container.querySelector("#term-quick-send")!.addEventListener("click", () => {
    if (!quickText.value.trim()) return;
    dispatchLive(ACTOR_ID, { type: "TYPE", text: quickText.value, raid: quickRaid.checked, skin });
  });

  function renderQueue() {
    queueList.innerHTML =
      queue
        .map(
          (id, i) => `
        <div class="list-item" style="margin-top:${i === 0 ? "0" : "6px"};">
          <span>${i + 1}. ${archives[id]?.label || id}</span>
          <button class="term-queue-rm" data-i="${i}" style="width:auto; padding:2px 8px;">×</button>
        </div>`,
        )
        .join("") || `<p style="color:var(--text-dim); font-size:0.8rem; margin:0;">File vide — ajoutez des protocoles depuis la bibliothèque.</p>`;

    queueList.querySelectorAll<HTMLButtonElement>(".term-queue-rm").forEach((btn) =>
      btn.addEventListener("click", () => {
        queue.splice(Number(btn.dataset.i), 1);
        renderQueue();
      }),
    );
  }

  renderArchiveLibrary(container.querySelector("#term-archive-lib")!, {
    editable: true,
    onFire: (archive) => dispatchLive(ACTOR_ID, { type: "TYPE", text: archive.text, raid: archive.raid, skin }),
    onQueueAdd: (archive) => {
      queue.push(archive.id);
      renderQueue();
    },
  });

  playBtn.addEventListener("click", () => runSequence());
  container.querySelector("#term-stop")!.addEventListener("click", () => {
    isRunning = false;
    isLooping = false;
    loopBtn.textContent = "Boucle : OFF";
    runToken++;
  });
  loopBtn.addEventListener("click", () => {
    isLooping = !isLooping;
    loopBtn.textContent = `Boucle : ${isLooping ? "ON" : "OFF"}`;
  });
  skinSelect.addEventListener("change", () => (skin = skinSelect.value as Skin));
  container.querySelector("#term-reset")!.addEventListener("click", () => resetLive(ACTOR_ID));

  async function runSequence() {
    if (isRunning || queue.length === 0) return;
    isRunning = true;
    const myRun = ++runToken;

    do {
      for (const id of queue) {
        if (myRun !== runToken) return;
        const archive = archives[id];
        if (!archive) continue;
        dispatchLive(ACTOR_ID, { type: "TYPE", text: archive.text, raid: archive.raid, skin });
        const waitMs = archive.text.length * 40 + 2500;
        await new Promise((r) => setTimeout(r, waitMs));
      }
    } while (isLooping && myRun === runToken);

    isRunning = false;
  }

  watchArchives((data) => {
    archives = data;
    renderQueue();
  });
}
