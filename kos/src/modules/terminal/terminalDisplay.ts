import { watchLive } from "./data";
import type { LiveState } from "./data";

const RAID_DURATION_MS = 12000;

const STYLE = `
.kos-term-root { position: absolute; inset: 0; overflow: hidden; font-family: "Courier New", monospace; }

/* --- Skin CLASSIC : terminal cyan phosphore (hérité de terminal/display_idle.html) --- */
.kos-term-root.skin-classic {
  color: rgba(0, 255, 255, 0.85);
  font-size: 22px;
  text-shadow: 0 0 6px #00ffff;
  transition: filter 0.3s ease;
}
.kos-term-root.skin-classic .kos-term-box {
  position: absolute; bottom: 40px; left: 40px; width: 85%; line-height: 1.4; white-space: pre-wrap;
}
.kos-term-root.skin-classic .kos-term-meta { display: none; }
.kos-term-root.skin-classic.raid {
  animation: kos-term-shake 0.2s infinite;
  filter: hue-rotate(110deg) contrast(180%) brightness(1.3);
}
@keyframes kos-term-shake {
  0% { transform: translate(0, 0); }
  25% { transform: translate(-4px, 4px); }
  50% { transform: translate(4px, -4px); }
  75% { transform: translate(-4px, -4px); }
  100% { transform: translate(4px, 4px); }
}

/* --- Skin TECHWEAR : HUD minimal (hérité de Terminal techwear/Techwear_Display.html) --- */
.kos-term-root.skin-techwear {
  font-family: "Inter", "Segoe UI", sans-serif;
  color: #fff;
  display: flex; align-items: flex-end; padding: 50px;
  transition: background 0.4s cubic-bezier(0.16, 1, 0.3, 1);
}
.kos-term-root.skin-techwear .kos-term-box {
  border-left: 2px solid #fff; padding-left: 26px;
  opacity: 0; transform: translateY(20px);
  transition: all 0.6s cubic-bezier(0.16, 1, 0.3, 1);
}
.kos-term-root.skin-techwear .kos-term-box.visible { opacity: 1; transform: translateY(0); }
.kos-term-root.skin-techwear .kos-term-meta {
  font-size: 10px; letter-spacing: 5px; color: rgba(255,255,255,0.4); margin-bottom: 8px; font-weight: 700;
}
.kos-term-root.skin-techwear .kos-term-text {
  font-size: 30px; font-weight: 200; letter-spacing: 1px; text-transform: uppercase; white-space: pre-wrap;
}
.kos-term-root.skin-techwear.raid { background: #ff003c; }
.kos-term-root.skin-techwear.raid .kos-term-box { border-left-color: #000; }
.kos-term-root.skin-techwear.raid .kos-term-text,
.kos-term-root.skin-techwear.raid .kos-term-meta { color: #000; font-weight: 700; }
`;

function injectStyleOnce() {
  if (document.getElementById("kos-term-style")) return;
  const style = document.createElement("style");
  style.id = "kos-term-style";
  style.textContent = STYLE;
  document.head.appendChild(style);
}

async function typeLine(el: HTMLElement, text: string, charDelay: number) {
  for (const char of text) {
    el.textContent += char;
    await new Promise((r) => setTimeout(r, charDelay));
  }
}

export function mountTerminalDisplay(root: HTMLElement) {
  injectStyleOnce();
  root.classList.add("kos-term-root", "skin-classic");
  root.innerHTML = `
    <div class="kos-term-box">
      <div class="kos-term-meta">DATA_STREAM // NOMINAL</div>
      <div class="kos-term-text"></div>
    </div>`;

  const box = root.querySelector<HTMLElement>(".kos-term-box")!;
  const meta = root.querySelector<HTMLElement>(".kos-term-meta")!;
  const textEl = root.querySelector<HTMLElement>(".kos-term-text")!;

  let raidTimer: ReturnType<typeof setTimeout> | undefined;
  let runId = 0;

  async function render(state: LiveState) {
    root.classList.remove("skin-classic", "skin-techwear");
    root.classList.add(`skin-${state.skin}`);

    if (state.type === "RESET" || !state.text) {
      textEl.textContent = "";
      root.classList.remove("raid");
      box.classList.remove("visible");
      return;
    }

    clearTimeout(raidTimer);
    if (state.raid) {
      root.classList.add("raid");
      meta.textContent = "CRITICAL_ALERT // INTRUSION";
      raidTimer = setTimeout(() => root.classList.remove("raid"), RAID_DURATION_MS);
    } else {
      root.classList.remove("raid");
      meta.textContent = "DATA_STREAM // NOMINAL";
    }

    const myRun = ++runId;
    box.classList.remove("visible");
    textEl.textContent = "";
    await new Promise((r) => setTimeout(r, 150));
    if (myRun !== runId) return;
    box.classList.add("visible");

    for (const line of state.text.split("\n")) {
      if (myRun !== runId) return;
      if (textEl.textContent) textEl.textContent += "\n";
      await typeLine(textEl, line, 22);
    }
  }

  watchLive(render);
}
