import "../theme.css";
import { renderTerminalPanel } from "../modules/terminal/terminalPanel";

const overlayInput = document.getElementById("link-overlay") as HTMLInputElement;
overlayInput.value = `${window.location.origin}/modules/terminal/overlay.html`;

document.getElementById("copy-overlay")!.addEventListener("click", () => {
  navigator.clipboard.writeText(overlayInput.value);
});

renderTerminalPanel(document.getElementById("terminal-panel")!);
