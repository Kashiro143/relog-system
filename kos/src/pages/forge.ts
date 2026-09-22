import "../theme.css";
import { watchActors, watchModes, createActor, deleteActor, createMode, deleteMode } from "../registry";
import type { Permissions } from "../types";
import { PERMISSION_TYPES } from "../permissions";

// OBS Browser Source (et ce navigateur de prévisualisation) n'affichent pas
// fiablement les dialogues natifs alert()/confirm() : on utilise nos propres
// équivalents inline plutôt que de dépendre de l'API navigateur.
function flashError(anchor: HTMLElement, message: string) {
  const existing = anchor.querySelector<HTMLElement>(".field-error");
  if (existing) existing.remove();
  const el = document.createElement("div");
  el.className = "field-error";
  el.textContent = message;
  el.style.cssText = "color:var(--status-offline); font-size:0.75rem; margin-top:4px;";
  anchor.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

function armConfirmDelete(btn: HTMLButtonElement, onConfirm: () => void) {
  let armed = false;
  let resetTimer: ReturnType<typeof setTimeout>;
  btn.addEventListener("click", () => {
    if (!armed) {
      armed = true;
      btn.textContent = "Confirmer ?";
      btn.style.background = "#fff";
      resetTimer = setTimeout(() => {
        armed = false;
        btn.textContent = "×";
        btn.style.background = "";
      }, 3000);
      return;
    }
    clearTimeout(resetTimer);
    onConfirm();
  });
}

const permsContainer = document.getElementById("actor-perms")!;
permsContainer.innerHTML = PERMISSION_TYPES.map(
  (perm) => `<label><input type="checkbox" data-perm="${perm}" ${perm === "can_change_mode" ? "checked" : ""}/> ${perm}</label>`,
).join("");

const actorPanel = document.getElementById("actor-panel")!;
document.getElementById("actor-create")!.addEventListener("click", () => {
  const id = (document.getElementById("actor-id") as HTMLInputElement).value.trim();
  if (!id) return flashError(actorPanel, "ID requis.");

  const permissions = {} as Permissions;
  permsContainer.querySelectorAll<HTMLInputElement>("input[data-perm]").forEach((el) => {
    permissions[el.dataset.perm!] = el.checked;
  });

  createActor({
    id,
    name: (document.getElementById("actor-name") as HTMLInputElement).value || id,
    color: (document.getElementById("actor-color") as HTMLInputElement).value,
    currentMode: "idle",
    status: "offline",
    permissions,
  });
});

const modePanel = document.getElementById("mode-panel")!;
document.getElementById("mode-create")!.addEventListener("click", () => {
  const id = (document.getElementById("mode-id") as HTMLInputElement).value.trim();
  if (!id) return flashError(modePanel, "ID requis.");

  createMode({
    id,
    label: (document.getElementById("mode-label") as HTMLInputElement).value || id,
    overlayUrl: (document.getElementById("mode-overlay") as HTMLInputElement).value,
    playerUrl: (document.getElementById("mode-player") as HTMLInputElement).value,
  });
});

watchActors((actors) => {
  const list = document.getElementById("actor-list")!;
  list.innerHTML = Object.values(actors)
    .map(
      (a) =>
        `<div class="list-item"><span><span class="status-dot" style="background:${a.color}"></span> ${a.name}</span><button class="del" data-id="${a.id}">×</button></div>`,
    )
    .join("");
  list.querySelectorAll<HTMLButtonElement>(".del").forEach((btn) => {
    armConfirmDelete(btn, () => deleteActor(btn.dataset.id!));
  });
});

watchModes((modes) => {
  const list = document.getElementById("mode-list")!;
  list.innerHTML = Object.values(modes)
    .map((m) => `<div class="list-item"><span>${m.label}</span><button class="del" data-id="${m.id}">×</button></div>`)
    .join("");
  list.querySelectorAll<HTMLButtonElement>(".del").forEach((btn) => {
    armConfirmDelete(btn, () => deleteMode(btn.dataset.id!));
  });
});
