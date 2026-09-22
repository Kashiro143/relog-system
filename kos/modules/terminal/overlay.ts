import { mountTerminalDisplay } from "../../src/modules/terminal/terminalDisplay";

const actorId = new URLSearchParams(window.location.search).get("u") ?? "Kashiro";
mountTerminalDisplay(document.getElementById("root")!, actorId);
