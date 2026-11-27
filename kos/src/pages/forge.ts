import "../theme.css";
import { watchActors, watchModes, createActor, deleteActor, createMode, deleteMode } from "../registry";
import type { Permissions } from "../types";
import { PERMISSION_TYPES } from "../permissions";
import { flashError, armConfirmDelete } from "../ui/dialogs";
import { requireMember, watchInvites, watchOwner, createInvite, deleteInvite, claimOwnership, emailKey } from "../auth";
import { appUrl } from "../appUrl";

const member = await requireMember({ ownerOnly: true });

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
  renderInviteActorOptions(actors);
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

// --- Propriétaire et invitations ---

const ownerClaim = document.getElementById("owner-claim")!;
watchOwner((ownerKey) => {
  ownerClaim.style.display = ownerKey ? "none" : "block";
});
document.getElementById("owner-claim-btn")!.addEventListener("click", () => claimOwnership(member.email));

const loginLink = document.getElementById("login-link") as HTMLInputElement;
loginLink.value = appUrl("login.html");
document.getElementById("login-copy")!.addEventListener("click", () => navigator.clipboard.writeText(loginLink.value));

const inviteActor = document.getElementById("invite-actor") as HTMLSelectElement;
function renderInviteActorOptions(actors: Record<string, { id: string; name: string }>) {
  const current = inviteActor.value;
  inviteActor.innerHTML = Object.values(actors)
    .map((a) => `<option value="${a.id}">${a.name}</option>`)
    .join("");
  if (current) inviteActor.value = current;
}

const invitePanel = document.getElementById("invite-panel")!;
document.getElementById("invite-create")!.addEventListener("click", async () => {
  const emailInput = document.getElementById("invite-email") as HTMLInputElement;
  const email = emailInput.value.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return flashError(invitePanel, "Adresse e-mail invalide.");
  if (/[#$\[\]\/<>"']/.test(email)) return flashError(invitePanel, "Cette adresse contient un caractère non pris en charge.");
  if (!inviteActor.value) return flashError(invitePanel, "Choisis un membre.");
  await createInvite(email, inviteActor.value);
  emailInput.value = "";
});

watchInvites((invites) => {
  const list = document.getElementById("invite-list")!;
  const myKey = emailKey(member.email);
  list.innerHTML = Object.entries(invites)
    .map(
      ([key, inv]) =>
        `<div class="list-item"><span>${inv.email} → <strong>${inv.actorId}</strong>${key === myKey ? " (toi)" : ""}</span><button class="del" data-key="${key}">×</button></div>`,
    )
    .join("");
  list.querySelectorAll<HTMLButtonElement>(".del").forEach((btn) => {
    armConfirmDelete(btn, () => deleteInvite(btn.dataset.key!));
  });
});
