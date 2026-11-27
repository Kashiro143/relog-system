import { watchArchives, dispatchLive, resetLive } from "./data";
import type { Archive, Skin } from "./data";
import { renderArchiveLibrary } from "./archiveLibrary";

const ACTOR_ID = "Kashiro";

const STYLE = `
.tp-queue { display: grid; gap: 6px; margin-bottom: 12px; }
.tp-queue .list-item { margin: 0; padding: 7px 8px 7px 12px; border-left-color: var(--border); }
.tp-queue .list-item.current { border-left-color: var(--status-online); background: rgba(0,255,136,0.06); }
.tp-queue .n { color: var(--text-faint); font-family: var(--font-mono); font-size: 12px; margin-right: 8px; }
.tp-queue .lbl { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
.tp-queue .acts { display: flex; gap: 4px; flex: none; }
.tp-live { display: grid; gap: 10px; }
`;

/** Page dédiée de Kashiro : message en direct, séquence en boucle et bibliothèque d'archives (éditable). */
export function renderTerminalPanel(container: HTMLElement) {
  let archives: Record<string, Archive> = {};
  let queue: string[] = [];
  let skin: Skin = "classic";
  let isLooping = false;
  let isRunning = false;
  let current = -1;
  let runToken = 0;

  container.innerHTML = `
    <style>${STYLE}</style>
    <div class="term-grid">
      <div class="term-col">
        <section class="panel tp-live">
          <h4 style="margin:0">Message en direct</h4>
          <textarea id="term-quick-text" class="mono" rows="3" placeholder="Message à afficher sur ton overlay… (Ctrl + Entrée pour envoyer)"></textarea>
          <div class="btn-row">
            <label class="check" title="Effet de glitch rouge"><input type="checkbox" id="term-quick-raid" /> Mode RAID</label>
            <label class="check push">Style
              <select id="term-skin">
                <option value="classic">Classique</option>
                <option value="techwear">Techwear</option>
              </select>
            </label>
          </div>
          <div class="btn-row">
            <button id="term-quick-send" class="primary">Envoyer</button>
            <button id="term-reset" class="danger push" title="Vide l'écran du terminal sur l'overlay">Effacer l'écran</button>
          </div>
          <div class="feedback" id="term-feedback" aria-live="polite"></div>
        </section>

        <section class="panel">
          <h4>Séquence</h4>
          <p class="hint" style="margin:-8px 0 12px">Ajoute des archives avec « + File », puis lance-les à la suite (pratique pour un écran d'attente).</p>
          <div id="term-queue" class="tp-queue"></div>
          <div class="btn-row">
            <button id="term-play" class="primary">▶ Lancer</button>
            <button id="term-stop">■ Stop</button>
            <button id="term-loop" aria-pressed="false" title="Recommencer au début une fois la séquence finie">🔁 Boucle</button>
            <button id="term-clear" class="danger push btn-sm">Vider</button>
          </div>
          <div class="feedback" id="term-seq-state" aria-live="polite"></div>
        </section>
      </div>

      <section class="panel">
        <h4>Archives</h4>
        <p class="hint" style="margin:-8px 0 12px">Bibliothèque partagée du lore : ▶ l'affiche tout de suite, « + File » l'ajoute à la séquence.</p>
        <div id="term-archive-lib"></div>
      </section>
    </div>
  `;

  const $ = <T extends HTMLElement>(sel: string) => container.querySelector<T>(sel)!;
  const quickText = $<HTMLTextAreaElement>("#term-quick-text");
  const quickRaid = $<HTMLInputElement>("#term-quick-raid");
  const queueList = $<HTMLElement>("#term-queue");
  const playBtn = $<HTMLButtonElement>("#term-play");
  const loopBtn = $<HTMLButtonElement>("#term-loop");
  const skinSelect = $<HTMLSelectElement>("#term-skin");
  const feedbackEl = $<HTMLElement>("#term-feedback");
  const seqState = $<HTMLElement>("#term-seq-state");

  let feedbackTimer: ReturnType<typeof setTimeout> | undefined;
  function feedback(kind: "ok" | "err", text: string) {
    feedbackEl.className = `feedback ${kind}`;
    feedbackEl.textContent = text;
    clearTimeout(feedbackTimer);
    feedbackTimer = setTimeout(() => (feedbackEl.textContent = ""), 3000);
  }

  async function fire(text: string, raid: boolean, label?: string) {
    try {
      await dispatchLive(ACTOR_ID, { type: "TYPE", text, raid, skin });
      feedback("ok", label ? `« ${label} » affiché ✓` : "Envoyé ✓");
    } catch {
      feedback("err", "Envoi refusé.");
    }
  }

  function sendQuick() {
    const text = quickText.value.trim();
    if (!text) return feedback("err", "Écris d'abord un message.");
    fire(quickText.value, quickRaid.checked);
  }
  $("#term-quick-send").addEventListener("click", sendQuick);
  quickText.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      sendQuick();
    }
  });

  function renderQueue() {
    queueList.replaceChildren();
    if (!queue.length) {
      const p = document.createElement("p");
      p.className = "empty";
      p.textContent = "Séquence vide.";
      queueList.appendChild(p);
    }
    queue.forEach((id, i) => {
      const row = document.createElement("div");
      row.className = `list-item${i === current ? " current" : ""}`;
      row.innerHTML = `<span class="n">${i + 1}</span><span class="lbl"></span><span class="acts">
        <button class="btn-sm" data-act="up" title="Monter"${i === 0 ? " disabled" : ""}>↑</button>
        <button class="btn-sm" data-act="down" title="Descendre"${i === queue.length - 1 ? " disabled" : ""}>↓</button>
        <button class="btn-sm danger" data-act="rm" title="Retirer">×</button></span>`;
      row.querySelector(".lbl")!.textContent = archives[id]?.label || id;
      row.querySelector(".acts")!.addEventListener("click", (e) => {
        const act = (e.target as HTMLElement).closest("button")?.dataset.act;
        if (act === "rm") queue.splice(i, 1);
        else if (act === "up" && i > 0) [queue[i - 1], queue[i]] = [queue[i], queue[i - 1]];
        else if (act === "down" && i < queue.length - 1) [queue[i + 1], queue[i]] = [queue[i], queue[i + 1]];
        else return;
        renderQueue();
      });
      queueList.appendChild(row);
    });
    playBtn.disabled = isRunning || queue.length === 0;
    seqState.className = "feedback";
    seqState.textContent = isRunning
      ? `En cours : ${current + 1} / ${queue.length}${isLooping ? " · en boucle" : ""}`
      : queue.length
        ? `${queue.length} archive${queue.length > 1 ? "s" : ""} prête${queue.length > 1 ? "s" : ""}.`
        : "";
  }

  renderArchiveLibrary($("#term-archive-lib"), {
    editable: true,
    onFire: (archive) => fire(archive.text, archive.raid, archive.label || archive.id),
    onQueueAdd: (archive) => {
      queue.push(archive.id);
      renderQueue();
    },
  });

  function stop() {
    isRunning = false;
    current = -1;
    runToken++;
    renderQueue();
  }

  playBtn.addEventListener("click", () => runSequence());
  $("#term-stop").addEventListener("click", stop);
  $("#term-clear").addEventListener("click", () => {
    stop();
    queue = [];
    renderQueue();
  });
  loopBtn.addEventListener("click", () => {
    isLooping = !isLooping;
    loopBtn.classList.toggle("on", isLooping);
    loopBtn.setAttribute("aria-pressed", String(isLooping));
    renderQueue();
  });
  skinSelect.addEventListener("change", () => (skin = skinSelect.value as Skin));
  $("#term-reset").addEventListener("click", async () => {
    await resetLive(ACTOR_ID);
    feedback("ok", "Écran effacé ✓");
  });

  async function runSequence() {
    if (isRunning || queue.length === 0) return;
    isRunning = true;
    const myRun = ++runToken;

    do {
      for (let i = 0; i < queue.length; i++) {
        if (myRun !== runToken) return;
        const archive = archives[queue[i]];
        if (!archive) continue;
        current = i;
        renderQueue();
        dispatchLive(ACTOR_ID, { type: "TYPE", text: archive.text, raid: archive.raid, skin });
        const waitMs = archive.text.length * 40 + 2500;
        await new Promise((r) => setTimeout(r, waitMs));
      }
    } while (isLooping && myRun === runToken);

    if (myRun === runToken) stop();
  }

  watchArchives((data) => {
    archives = data;
    renderQueue();
  });
}
