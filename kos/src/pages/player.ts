import { Kernel } from "../kernel";

const container = document.getElementById("module-container") as HTMLIFrameElement;
const indicator = document.getElementById("status-indicator")!;

new Kernel("player", {
  container,
  onModeChange: () => indicator.classList.add("online"),
});
