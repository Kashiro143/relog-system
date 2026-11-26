import { Kernel } from "../kernel";
import { mountTerminalDisplay } from "../modules/terminal/terminalDisplay";
import { watchMuted } from "../relog/overlayControl";

const container = document.getElementById("module-container") as HTMLIFrameElement;
const kernel = new Kernel("overlay", { container });

if (kernel.actorId) {
  const collective = document.getElementById("collective-layer")!;
  mountTerminalDisplay(document.getElementById("signal-layer")!, kernel.actorId);
  watchMuted(kernel.actorId, (muted) => {
    collective.style.display = muted ? "none" : "";
  });
}
