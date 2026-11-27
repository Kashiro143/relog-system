import { Kernel } from "../kernel";
import { mountTerminalDisplay } from "../modules/terminal/terminalDisplay";
import { watchMuted } from "../relog/overlayControl";
import { mountGifDisplay } from "../relog/gifDisplay";
import { mountRoomDisplay } from "../relog/roomDisplay";

const container = document.getElementById("module-container") as HTMLIFrameElement;
const kernel = new Kernel("overlay", { container });

if (kernel.actorId) {
  const collective = document.getElementById("collective-layer")!;
  const roomDisplay = mountRoomDisplay(document.getElementById("room-layer")!, document.getElementById("video-layer")!, kernel.actorId);
  mountTerminalDisplay(document.getElementById("signal-layer")!, kernel.actorId);
  const gifs = mountGifDisplay(document.getElementById("gif-layer")!, kernel.actorId);
  watchMuted(kernel.actorId, (muted) => {
    collective.style.display = muted ? "none" : "";
    gifs.setMuted(muted);
    roomDisplay.setMuted(muted);
  });
}
