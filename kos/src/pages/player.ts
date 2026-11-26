import { Kernel } from "../kernel";
import { watchMuted, panic, unmute } from "../relog/overlayControl";

const container = document.getElementById("module-container") as HTMLIFrameElement;
const indicator = document.getElementById("status-indicator")!;
const panicBtn = document.getElementById("panic-btn") as HTMLButtonElement;

const kernel = new Kernel("player", {
  container,
  onModeChange: () => indicator.classList.add("online"),
});

if (kernel.actorId) {
  let muted = false;
  watchMuted(kernel.actorId, (value) => {
    muted = value;
    panicBtn.classList.toggle("muted", muted);
    panicBtn.textContent = muted ? "▶ Réactiver mon overlay Re:log" : "🛑 Couper mon overlay Re:log";
  });
  panicBtn.addEventListener("click", () => (muted ? unmute(kernel.actorId) : panic(kernel.actorId)));
} else {
  panicBtn.style.display = "none";
}
