import "../theme.css";
import { renderTerminalPanel } from "../modules/terminal/terminalPanel";
import { appUrl } from "../appUrl";
import { requireMember } from "../auth";

await requireMember({ ownerOnly: true });

const overlayInput = document.getElementById("link-overlay") as HTMLInputElement;
overlayInput.value = appUrl("modules/terminal/overlay.html");
overlayInput.addEventListener("focus", () => overlayInput.select());

const copyBtn = document.getElementById("copy-overlay") as HTMLButtonElement;
copyBtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(overlayInput.value);
  } catch {
    overlayInput.select();
    document.execCommand("copy");
  }
  copyBtn.textContent = "Copié ✓";
  setTimeout(() => (copyBtn.textContent = "Copier"), 1200);
});

renderTerminalPanel(document.getElementById("terminal-panel")!);
