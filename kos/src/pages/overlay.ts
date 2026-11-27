import { Kernel } from "../kernel";
import { mountTerminalDisplay } from "../modules/terminal/terminalDisplay";
import { watchMuted } from "../relog/overlayControl";
import { mountGifDisplay } from "../relog/gifDisplay";
import { mountRoomDisplay } from "../relog/roomDisplay";

const container = document.getElementById("module-container") as HTMLIFrameElement;
// ?module=0 : le module (ex. équipe PokeMMO) est affiché par sa propre source OBS (module.html).
const withModule = new URLSearchParams(location.search).get("module") !== "0";
const kernel = new Kernel("overlay", { container, modules: withModule });

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
