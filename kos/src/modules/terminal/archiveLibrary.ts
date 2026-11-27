import { watchArchives, saveArchive, deleteArchive } from "./data";
import type { Archive } from "./data";
import { armConfirmDelete, flashError } from "../../ui/dialogs";

export interface ArchiveLibraryOptions {
  /** Bouton "▶" — envoyer cette archive immédiatement. */
  onFire?: (archive: Archive) => void;
  /** Bouton "+ File" — ajouter à la séquence. */
  onQueueAdd?: (archive: Archive) => void;
  /** Affiche la création/édition/suppression. Kashiro seulement : c'est lui l'auteur du lore. */
  editable?: boolean;
}

const STYLE = `
.al-tools { display: flex; gap: 8px; margin-bottom: 10px; }
.al-tools input { flex: 1; min-width: 0; }
.al-list { display: grid; gap: 6px; max-height: 520px; overflow-y: auto; padding-right: 2px; }
.al-item { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 2px 10px; align-items: center; background: var(--panel-bg-alt); border-left: 3px solid var(--accent-neon); border-radius: 4px; padding: 8px 8px 8px 12px; }
.al-item.raid { border-left-color: var(--status-offline); }
.al-item .lbl { font-size: 13px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.al-item .txt { grid-column: 1; font-family: var(--font-mono); font-size: 11px; color: var(--text-dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.al-item .acts { grid-row: span 2; display: flex; gap: 4px; }
.al-editor { margin-top: 12px; padding: 14px; border: 1px dashed var(--border); border-radius: var(--radius); display: grid; gap: 10px; }
.al-editor h5 { margin: 0; font-size: 12px; letter-spacing: 1px; text-transform: uppercase; color: var(--accent-neon); }
`;

/** Identifiant Firebase lisible tiré du nom (pas de . # $ [ ] /). */
function slugify(label: string): string {
  return (
    label
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40) || `archive_${Date.now().toString(36)}`
  );
}

/** Bibliothèque d'archives (lore) — contenu partagé, potentiellement affiché sur n'importe quel acteur. */
export function renderArchiveLibrary(container: HTMLElement, options: ArchiveLibraryOptions = {}): () => void {
  let archives: Record<string, Archive> = {};
  let editingId: string | null = null;
  let filter = "";

  container.innerHTML = `
    <style>${STYLE}</style>
    <div class="al-tools">
      <input type="search" class="al-search" placeholder="Rechercher une archive…" aria-label="Rechercher une archive" />
      ${options.editable ? `<button class="al-new primary btn-sm">+ Nouvelle</button>` : ""}
    </div>
    <div class="al-list"></div>
    ${
      options.editable
        ? `
      <form class="al-editor" hidden>
        <h5 class="al-ed-title">Nouvelle archive</h5>
        <div class="field"><label>Nom</label><input class="al-ed-label" placeholder="Ex : Démarrage du noyau" required /></div>
        <div class="field"><label>Texte affiché</label><textarea class="al-ed-text mono" rows="4" placeholder="> INITIALISATION…"></textarea></div>
        <label class="check"><input type="checkbox" class="al-ed-raid" /> Déclenche le mode RAID (glitch)</label>
        <div class="btn-row">
          <button type="submit" class="primary">Enregistrer</button>
          <button type="button" class="al-ed-cancel">Annuler</button>
          <span class="hint push al-ed-id"></span>
        </div>
      </form>`
        : ""
    }
  `;

  const list = container.querySelector<HTMLElement>(".al-list")!;
  const search = container.querySelector<HTMLInputElement>(".al-search")!;
  search.addEventListener("input", () => {
    filter = search.value.trim().toLowerCase();
    renderList();
  });

  function iconBtn(act: string, text: string, title: string, extra = "") {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `btn-sm ${extra}`.trim();
    b.dataset.act = act;
    b.textContent = text;
    b.title = title;
    return b;
  }

  function renderList() {
    list.replaceChildren();
    const all = Object.values(archives).sort((a, b) => (a.label || a.id).localeCompare(b.label || b.id));
    const shown = filter
      ? all.filter((a) => `${a.label} ${a.id} ${a.text}`.toLowerCase().includes(filter))
      : all;
    if (!shown.length) {
      const p = document.createElement("p");
      p.className = "empty";
      p.textContent = all.length ? "Aucune archive ne correspond." : "Aucune archive pour l'instant.";
      list.appendChild(p);
      return;
    }
    for (const a of shown) {
      const row = document.createElement("div");
      row.className = `al-item${a.raid ? " raid" : ""}`;
      const lbl = document.createElement("span");
      lbl.className = "lbl";
      lbl.textContent = `${a.raid ? "🚨 " : ""}${a.label || a.id}`;
      const acts = document.createElement("span");
      acts.className = "acts";
      if (options.onFire) acts.appendChild(iconBtn("fire", "▶", "Afficher maintenant", "primary"));
      if (options.onQueueAdd) acts.appendChild(iconBtn("queue", "+ File", "Ajouter à la séquence"));
      if (options.editable) {
        acts.appendChild(iconBtn("edit", "✎", "Modifier"));
        const del = iconBtn("del", "×", "Supprimer (cliquer deux fois)", "danger");
        armConfirmDelete(del, () => deleteArchive(a.id));
        acts.appendChild(del);
      }
      const txt = document.createElement("span");
      txt.className = "txt";
      txt.textContent = a.text.replace(/\s+/g, " ");
      txt.title = a.text;
      row.append(lbl, acts, txt);
      acts.addEventListener("click", (e) => {
        const act = (e.target as HTMLElement).closest("button")?.dataset.act;
        if (act === "fire") options.onFire?.(a);
        else if (act === "queue") options.onQueueAdd?.(a);
        else if (act === "edit") openEditor(a.id);
      });
      list.appendChild(row);
    }
  }

  const form = container.querySelector<HTMLFormElement>(".al-editor");

  function openEditor(id: string | null) {
    if (!form) return;
    editingId = id;
    const archive = id ? archives[id] : null;
    form.hidden = false;
    form.querySelector(".al-ed-title")!.textContent = archive ? "Modifier l'archive" : "Nouvelle archive";
    form.querySelector<HTMLInputElement>(".al-ed-label")!.value = archive?.label ?? "";
    form.querySelector<HTMLTextAreaElement>(".al-ed-text")!.value = archive?.text ?? "";
    form.querySelector<HTMLInputElement>(".al-ed-raid")!.checked = archive?.raid ?? false;
    form.querySelector(".al-ed-id")!.textContent = archive ? `id : ${archive.id}` : "";
    form.querySelector<HTMLInputElement>(".al-ed-label")!.focus();
    form.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  function closeEditor() {
    if (!form) return;
    editingId = null;
    form.hidden = true;
  }

  if (form) {
    container.querySelector(".al-new")!.addEventListener("click", () => openEditor(null));
    form.querySelector(".al-ed-cancel")!.addEventListener("click", closeEditor);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const label = form.querySelector<HTMLInputElement>(".al-ed-label")!.value.trim();
      const text = form.querySelector<HTMLTextAreaElement>(".al-ed-text")!.value;
      const raid = form.querySelector<HTMLInputElement>(".al-ed-raid")!.checked;
      if (!label) return flashError(form, "Donne un nom à l'archive.");
      if (!text.trim()) return flashError(form, "Le texte est vide.");
      let id = editingId;
      if (!id) {
        const base = slugify(label);
        id = base;
        for (let n = 2; archives[id]; n++) id = `${base}_${n}`;
      }
      try {
        await saveArchive({ id, label, text, raid });
        closeEditor();
      } catch {
        flashError(form, "Enregistrement refusé.");
      }
    });
  }

  return watchArchives((data) => {
    archives = data;
    renderList();
  });
}
