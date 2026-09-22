import { watchArchives, saveArchive, deleteArchive } from "./data";
import type { Archive } from "./data";
import { armConfirmDelete, flashError } from "../../ui/dialogs";

export interface ArchiveLibraryOptions {
  /** Bouton "▶" — envoyer cette archive immédiatement. */
  onFire?: (archive: Archive) => void;
  /** Bouton "+file" — ajouter à une file d'attente (séquenceur). */
  onQueueAdd?: (archive: Archive) => void;
  /** Affiche la création/édition/suppression. Kashiro seulement : c'est lui l'auteur du lore. */
  editable?: boolean;
}

/** Bibliothèque d'archives (lore) — contenu partagé, potentiellement affiché sur n'importe quel acteur. */
export function renderArchiveLibrary(container: HTMLElement, options: ArchiveLibraryOptions = {}) {
  let archives: Record<string, Archive> = {};
  let editingId: string | null = null;

  container.innerHTML = `
    <div id="al-list"></div>
    ${options.editable ? `<button id="al-new" style="width:100%; margin-top:10px; border-style:dashed;">+ Nouveau protocole</button>` : ""}
    ${
      options.editable
        ? `
      <div class="panel" id="al-editor-panel" style="margin-top:16px;">
        <h4 id="al-editor-title">Nouveau protocole</h4>
        <input id="al-ed-id" placeholder="ID (ex: 01_boot_core)" style="width:100%; margin-bottom:8px;" />
        <input id="al-ed-label" placeholder="Nom affiché" style="width:100%; margin-bottom:8px;" />
        <textarea id="al-ed-text" placeholder="Texte à afficher" rows="4" style="width:100%; margin-bottom:8px; font-family:var(--font-mono); background:#000; color:var(--text-main); border:1px solid var(--border); border-radius:4px; padding:8px;"></textarea>
        <label style="font-size:0.8rem; display:flex; align-items:center; gap:6px; margin-bottom:10px;">
          <input type="checkbox" id="al-ed-raid" /> Déclenche le mode RAID (glitch)
        </label>
        <button id="al-ed-save" style="width:100%;">Enregistrer</button>
      </div>`
        : ""
    }
  `;

  const list = container.querySelector<HTMLElement>("#al-list")!;

  function renderList() {
    list.innerHTML =
      Object.values(archives)
        .map(
          (a) => `
        <div class="list-item" data-id="${a.id}">
          <span>${a.raid ? "🚨 " : ""}${a.label || a.id}</span>
          <span style="display:flex; gap:6px;">
            ${options.onFire ? `<button class="al-fire" data-id="${a.id}" style="width:auto; padding:4px 8px; font-size:0.7rem;">▶</button>` : ""}
            ${options.onQueueAdd ? `<button class="al-queue" data-id="${a.id}" style="width:auto; padding:4px 8px; font-size:0.7rem;">+file</button>` : ""}
            ${options.editable ? `<button class="al-edit" data-id="${a.id}" style="width:auto; padding:4px 8px; font-size:0.7rem;">✎</button>` : ""}
            ${options.editable ? `<button class="al-del" data-id="${a.id}" style="width:auto; padding:4px 8px; font-size:0.7rem; background:var(--status-offline); color:white;">×</button>` : ""}
          </span>
        </div>`,
        )
        .join("") || `<p style="color:var(--text-dim); font-size:0.8rem;">Aucune archive.</p>`;

    list.querySelectorAll<HTMLButtonElement>(".al-fire").forEach((btn) =>
      btn.addEventListener("click", () => options.onFire?.(archives[btn.dataset.id!])),
    );
    list.querySelectorAll<HTMLButtonElement>(".al-queue").forEach((btn) =>
      btn.addEventListener("click", () => options.onQueueAdd?.(archives[btn.dataset.id!])),
    );
    list.querySelectorAll<HTMLButtonElement>(".al-edit").forEach((btn) =>
      btn.addEventListener("click", () => openEditor(btn.dataset.id!)),
    );
    list.querySelectorAll<HTMLButtonElement>(".al-del").forEach((btn) =>
      armConfirmDelete(btn, () => deleteArchive(btn.dataset.id!)),
    );
  }

  function openEditor(id: string | null) {
    if (!options.editable) return;
    editingId = id;
    const archive = id ? archives[id] : null;
    const title = container.querySelector<HTMLElement>("#al-editor-title")!;
    const edId = container.querySelector<HTMLInputElement>("#al-ed-id")!;
    const edLabel = container.querySelector<HTMLInputElement>("#al-ed-label")!;
    const edText = container.querySelector<HTMLTextAreaElement>("#al-ed-text")!;
    const edRaid = container.querySelector<HTMLInputElement>("#al-ed-raid")!;

    title.textContent = archive ? `Modifier : ${archive.id}` : "Nouveau protocole";
    edId.value = archive?.id ?? "";
    edId.disabled = Boolean(archive);
    edLabel.value = archive?.label ?? "";
    edText.value = archive?.text ?? "";
    edRaid.checked = archive?.raid ?? false;
  }

  if (options.editable) {
    container.querySelector("#al-new")!.addEventListener("click", () => openEditor(null));
    container.querySelector("#al-ed-save")!.addEventListener("click", () => {
      const edId = container.querySelector<HTMLInputElement>("#al-ed-id")!;
      const edLabel = container.querySelector<HTMLInputElement>("#al-ed-label")!;
      const edText = container.querySelector<HTMLTextAreaElement>("#al-ed-text")!;
      const edRaid = container.querySelector<HTMLInputElement>("#al-ed-raid")!;

      const id = editingId ?? edId.value.trim();
      if (!id) return flashError(container.querySelector("#al-editor-panel")!, "ID requis.");
      saveArchive({ id, label: edLabel.value || id, text: edText.value, raid: edRaid.checked });
      openEditor(null);
    });
  }

  watchArchives((data) => {
    archives = data;
    renderList();
  });
}
