import { mountTerminalDisplay } from "../../src/modules/terminal/terminalDisplay";

const actorId = new URLSearchParams(window.location.search).get("u") ?? "";
const root = document.getElementById("root")!;
if (actorId) mountTerminalDisplay(root, actorId);
