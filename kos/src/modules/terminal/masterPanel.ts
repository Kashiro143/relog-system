import { watchArchives, saveArchive, deleteArchive, dispatchLive, resetLive } from "./data";
import type { Archive, Skin } from "./data";
import { armConfirmDelete, flashError } from "../../ui/dialogs";

export function renderTerminalPanel(container: HTMLElement, actorId: string) {
  let archives: Record<string, Archive> = {};
  let queue: string[] = [];
  let editingId: string | null = null;
  let skin: Skin = "classic";
  let isLooping = false;
  let isRunning = false;
  let runToken = 0;

  container.innerHTML = `
    <div class="panel" style="margin-bottom:16px;">
      <h4>Archives (lore)</h4>
      <div id="term-archive-list"></div>
      <button id="term-new-archive" style="width:100%; margin-top:10px; border-style:dashed;">+ Nouveau protocole</button>
    </div>

    <div class="panel" style="margin-bottom:16px;">
      <h4>Séquenceur</h4>
      <div id="term-queue" style="min-height:40px; border:1px solid var(--border); border-radius:4px; padding:8px; margin-bottom:10px;"></div>
      <div style="display:flex; gap:8px; flex-wrap:wrap;">
        <button id="term-play">▶ Lancer la séquence</button>
        <button id="term-stop">■ Stop</button>
        <button id="term-loop">Boucle : OFF</button>
        <select id="term-skin" style="margin-left:auto;">
          <option value="classic">Skin : Classique</option>
          <option value="techwear">Skin : Techwear</option>
        </select>
      </div>
      <button id="term-reset" style="width:100%; margin-top:10px; color:var(--status-offline); border-color:var(--status-offline);">Effacer l'écran</button>
    </div>

    <div class="panel" id="term-editor-panel">
      <h4 id="term-editor-title">Nouveau protocole</h4>
      <input id="term-ed-id" placeholder="ID (ex: 01_boot_core)" style="width:100%; margin-bottom:8px;" />
      <input id="term-ed-label" placeholder="Nom affiché" style="width:100%; margin-bottom:8px;" />
      <textarea id="term-ed-text" placeholder="Texte à afficher (une ligne = une ligne tapée)" rows="4" style="width:100%; margin-bottom:8px; font-family:var(--font-mono); background:#000; color:var(--text-main); border:1px solid var(--border); border-radius:4px; padding:8px;"></textarea>
      <label style="font-size:0.8rem; display:flex; align-items:center; gap:6px; margin-bottom:10px;">
        <input type="checkbox" id="term-ed-raid" /> Déclenche le mode RAID (glitch)
      </label>
      <button id="term-ed-save" style="width:100%;">Enregistrer</button>
    </div>
  `;

  const archiveList = container.querySelector<HTMLElement>("#term-archive-list")!;
  const queueList = container.querySelector<HTMLElement>("#term-queue")!;
  const playBtn = container.querySelector<HTMLButtonElement>("#term-play")!;
  const loopBtn = container.querySelector<HTMLButtonElement>("#term-loop")!;
  const skinSelect = container.querySelector<HTMLSelectElement>("#term-skin")!;
  const editorTitle = container.querySelector<HTMLElement>("#term-editor-title")!;
  const edId = container.querySelector<HTMLInputElement>("#term-ed-id")!;
  const edLabel = container.querySelector<HTMLInputElement>("#term-ed-label")!;
  const edText = container.querySelector<HTMLTextAreaElement>("#term-ed-text")!;
  const edRaid = container.querySelector<HTMLInputElement>("#term-ed-raid")!;

  function renderArchives() {
    archiveList.innerHTML = Object.values(archives)
      .map(
        (a) => `
        <div class="list-item" data-id="${a.id}">
          <span>${a.raid ? "🚨 " : ""}${a.label || a.id}</span>
          <span style="display:flex; gap:6px;">
            <button class="term-fire" data-id="${a.id}" style="width:auto; padding:4px 8px; font-size:0.7rem;">▶</button>
            <button class="term-queue-add" data-id="${a.id}" style="width:auto; padding:4px 8px; font-size:0.7rem;">+file</button>
            <button class="term-edit" data-id="${a.id}" style="width:auto; padding:4px 8px; font-size:0.7rem;">✎</button>
            <button class="term-del" data-id="${a.id}" style="width:auto; padding:4px 8px; font-size:0.7rem; background:var(--status-offline); color:white;">×</button>
          </span>
        </div>`,
      )
      .join("") || `<p style="color:var(--text-dim); font-size:0.8rem;">Aucune archive — créez le premier protocole.</p>`;

    archiveList.querySelectorAll<HTMLButtonElement>(".term-fire").forEach((btn) =>
      btn.addEventListener("click", () => fireArchive(btn.dataset.id!)),
    );
    archiveList.querySelectorAll<HTMLButtonElement>(".term-queue-add").forEach((btn) =>
      btn.addEventListener("click", () => {
        queue.push(btn.dataset.id!);
        renderQueue();
      }),
    );
    archiveList.querySelectorAll<HTMLButtonElement>(".term-edit").forEach((btn) =>
      btn.addEventListener("click", () => openEditor(btn.dataset.id!)),
    );
    archiveList.querySelectorAll<HTMLButtonElement>(".term-del").forEach((btn) =>
      armConfirmDelete(btn, () => deleteArchive(btn.dataset.id!)),
    );
  }

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
        .join("") || `<p style="color:var(--text-dim); font-size:0.8rem; margin:0;">File vide — ajoutez des protocoles depuis la liste.</p>`;

    queueList.querySelectorAll<HTMLButtonElement>(".term-queue-rm").forEach((btn) =>
      btn.addEventListener("click", () => {
        queue.splice(Number(btn.dataset.i), 1);
        renderQueue();
      }),
    );
  }

  function fireArchive(id: string) {
    const archive = archives[id];
    if (!archive) return;
    dispatchLive(actorId, { type: "TYPE", text: archive.text, raid: archive.raid, skin });
  }

  function openEditor(id: string | null) {
    editingId = id;
    const archive = id ? archives[id] : null;
    editorTitle.textContent = archive ? `Modifier : ${archive.id}` : "Nouveau protocole";
    edId.value = archive?.id ?? "";
    edId.disabled = Boolean(archive);
    edLabel.value = archive?.label ?? "";
    edText.value = archive?.text ?? "";
    edRaid.checked = archive?.raid ?? false;
  }

  container.querySelector("#term-new-archive")!.addEventListener("click", () => openEditor(null));

  container.querySelector("#term-ed-save")!.addEventListener("click", () => {
    const id = editingId ?? edId.value.trim();
    if (!id) return flashError(container.querySelector("#term-editor-panel")!, "ID requis.");
    saveArchive({ id, label: edLabel.value || id, text: edText.value, raid: edRaid.checked });
    openEditor(null);
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
  container.querySelector("#term-reset")!.addEventListener("click", () => resetLive(actorId));

  async function runSequence() {
    if (isRunning || queue.length === 0) return;
    isRunning = true;
    const myRun = ++runToken;

    do {
      for (const id of queue) {
        if (myRun !== runToken) return;
        const archive = archives[id];
        if (!archive) continue;
        dispatchLive(actorId, { type: "TYPE", text: archive.text, raid: archive.raid, skin });
        const waitMs = archive.text.length * 40 + 2500;
        await new Promise((r) => setTimeout(r, waitMs));
      }
    } while (isLooping && myRun === runToken);

    isRunning = false;
  }

  watchArchives((data) => {
    archives = data;
    renderArchives();
    renderQueue();
  });
}
