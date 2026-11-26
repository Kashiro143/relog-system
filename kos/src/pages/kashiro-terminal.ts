import "../theme.css";
import { renderTerminalPanel } from "../modules/terminal/terminalPanel";
import { appUrl } from "../appUrl";

const overlayInput = document.getElementById("link-overlay") as HTMLInputElement;
overlayInput.value = appUrl("modules/terminal/overlay.html");

document.getElementById("copy-overlay")!.addEventListener("click", () => {
  navigator.clipboard.writeText(overlayInput.value);
});

renderTerminalPanel(document.getElementById("terminal-panel")!);
