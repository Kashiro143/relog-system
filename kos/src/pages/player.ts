import { Kernel } from "../kernel";
import { requireMember, blockPage } from "../auth";
import { watchMuted, panic, unmute } from "../relog/overlayControl";

const container = document.getElementById("module-container") as HTMLIFrameElement;
const indicator = document.getElementById("status-indicator")!;
const panicBtn = document.getElementById("panic-btn") as HTMLButtonElement;

async function main() {
  const member = await requireMember();

  // Un membre n'ouvre que son propre player ; Kashiro (propriétaire) peut ouvrir celui de n'importe qui.
  const requested = new URLSearchParams(window.location.search).get("u");
  if (requested && !member.isOwner && requested !== member.actorId) {
    blockPage("Player d'un autre membre", `Ce player appartient à ${requested}. Tu es connecté en tant que ${member.actorId}.`);
    return;
  }
  const actorId = requested ?? member.actorId;
  if (!actorId) {
    blockPage("Aucun membre choisi", "Ouvre le player d'un membre depuis Master (lien ?u=...).");
    return;
  }

  new Kernel("player", {
    container,
    actorId,
    onModeChange: () => indicator.classList.add("online"),
  });

  let muted = false;
  watchMuted(actorId, (value) => {
    muted = value;
    panicBtn.classList.toggle("muted", muted);
    panicBtn.textContent = muted ? "▶ Réactiver mon overlay Re:log" : "🛑 Couper mon overlay Re:log";
  });
  panicBtn.addEventListener("click", () => (muted ? unmute(actorId) : panic(actorId)));
}

main();
