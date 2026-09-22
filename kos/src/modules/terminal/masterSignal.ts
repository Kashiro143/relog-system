import { dispatchLive, resetLive } from "./data";
import type { Skin } from "./data";
import { renderArchiveLibrary } from "./archiveLibrary";

/** Panneau Master : Kashiro envoie un signal (texte libre ou archive) vers l'overlay d'un acteur choisi. */
export function renderMasterSignalPanel(container: HTMLElement, actorId: string): () => void {
  let skin: Skin = "classic";

  container.innerHTML = `
    <div class="panel" style="margin-bottom:16px;">
      <h4>Signal K-OS — vers l'overlay de ${actorId}</h4>
      <textarea id="ms-text" placeholder="Message à injecter en direct..." rows="3" style="width:100%; margin-bottom:8px; font-family:var(--font-mono); background:#000; color:var(--text-main); border:1px solid var(--border); border-radius:4px; padding:8px;"></textarea>
      <div style="display:flex; gap:8px; align-items:center; margin-bottom:10px;">
        <label style="font-size:0.8rem; display:flex; align-items:center; gap:6px;">
          <input type="checkbox" id="ms-raid" /> RAID (glitch)
        </label>
        <select id="ms-skin" style="margin-left:auto;">
          <option value="classic">Skin : Classique</option>
          <option value="techwear">Skin : Techwear</option>
        </select>
      </div>
      <button id="ms-send" style="width:100%; margin-bottom:8px;">Envoyer</button>
      <button id="ms-reset" style="width:100%; color:var(--status-offline); border-color:var(--status-offline);">Effacer l'écran</button>
      <hr style="border-color:var(--border); margin:14px 0;" />
      <div id="ms-archives"></div>
      <p style="color:var(--text-dim); font-size:0.7rem; margin-top:10px;">Overlay à ajouter dans OBS : ${window.location.origin}/modules/terminal/overlay.html?u=${actorId}</p>
    </div>
  `;

  const text = container.querySelector<HTMLTextAreaElement>("#ms-text")!;
  const raid = container.querySelector<HTMLInputElement>("#ms-raid")!;
  const skinSelect = container.querySelector<HTMLSelectElement>("#ms-skin")!;

  skinSelect.addEventListener("change", () => (skin = skinSelect.value as Skin));

  container.querySelector("#ms-send")!.addEventListener("click", () => {
    if (!text.value.trim()) return;
    dispatchLive(actorId, { type: "TYPE", text: text.value, raid: raid.checked, skin });
  });

  container.querySelector("#ms-reset")!.addEventListener("click", () => resetLive(actorId));

  return renderArchiveLibrary(container.querySelector("#ms-archives")!, {
    editable: false,
    onFire: (archive) => dispatchLive(actorId, { type: "TYPE", text: archive.text, raid: archive.raid, skin }),
  });
}
