import { dispatchLive, resetLive } from "./data";
import type { Skin } from "./data";
import { renderArchiveLibrary } from "./archiveLibrary";
import { watchMuted } from "../../relog/overlayControl";

/** Panneau Master : Kashiro envoie un signal (texte libre ou archive) vers l'overlay d'un acteur choisi. */
export function renderMasterSignalPanel(container: HTMLElement, actorId: string): () => void {
  let skin: Skin = "classic";

  container.innerHTML = `
    <div class="panel" style="display:grid; gap:10px;">
      <h4 style="margin:0">Signal K-OS — vers l'overlay de ${actorId}</h4>
      <p id="ms-muted" class="feedback err" hidden>🛑 ${actorId} a coupé son overlay Re:log : rien ne s'affichera chez lui.</p>
      <textarea id="ms-text" class="mono" rows="3" placeholder="Message à afficher… (Ctrl + Entrée pour envoyer)"></textarea>
      <div class="btn-row">
        <label class="check"><input type="checkbox" id="ms-raid" /> Mode RAID</label>
        <label class="check push">Style
          <select id="ms-skin">
            <option value="classic">Classique</option>
            <option value="techwear">Techwear</option>
          </select>
        </label>
      </div>
      <div class="btn-row">
        <button id="ms-send" class="primary">Envoyer</button>
        <button id="ms-reset" class="danger push">Effacer l'écran</button>
      </div>
      <div class="feedback" id="ms-feedback" aria-live="polite"></div>
      <hr style="border:none; border-top:1px solid var(--border); margin:4px 0;" />
      <div class="field-label">Archives</div>
      <div id="ms-archives"></div>
      <p class="hint" style="margin:0">S'affiche sur l'overlay Re:log de ${actorId}.</p>
    </div>
  `;

  const text = container.querySelector<HTMLTextAreaElement>("#ms-text")!;
  const raid = container.querySelector<HTMLInputElement>("#ms-raid")!;
  const skinSelect = container.querySelector<HTMLSelectElement>("#ms-skin")!;

  skinSelect.addEventListener("change", () => (skin = skinSelect.value as Skin));

  const feedbackEl = container.querySelector<HTMLElement>("#ms-feedback")!;
  let feedbackTimer: ReturnType<typeof setTimeout> | undefined;
  async function fire(run: () => Promise<unknown>, ok: string) {
    try {
      await run();
      feedbackEl.className = "feedback ok";
      feedbackEl.textContent = ok;
    } catch {
      feedbackEl.className = "feedback err";
      feedbackEl.textContent = "Envoi refusé : overlay coupé ?";
    }
    clearTimeout(feedbackTimer);
    feedbackTimer = setTimeout(() => (feedbackEl.textContent = ""), 3000);
  }
  const sendText = () => {
    if (!text.value.trim()) return;
    fire(() => dispatchLive(actorId, { type: "TYPE", text: text.value, raid: raid.checked, skin }), "Envoyé ✓");
  };
  container.querySelector("#ms-send")!.addEventListener("click", sendText);
  text.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      sendText();
    }
  });

  container.querySelector("#ms-reset")!.addEventListener("click", () => fire(() => resetLive(actorId), "Écran effacé ✓"));

  const mutedNotice = container.querySelector<HTMLElement>("#ms-muted")!;
  const stopMuted = watchMuted(actorId, (muted) => {
    mutedNotice.hidden = !muted;
  });

  const stopArchives = renderArchiveLibrary(container.querySelector("#ms-archives")!, {
    editable: false,
    onFire: (archive) => fire(() => dispatchLive(actorId, { type: "TYPE", text: archive.text, raid: archive.raid, skin }), `« ${archive.label || archive.id} » affiché ✓`),
  });

  return () => {
    stopMuted();
    stopArchives();
  };
}
