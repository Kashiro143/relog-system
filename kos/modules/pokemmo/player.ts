import "../../src/theme.css";
import { mountPokemmoPlayer } from "../../src/modules/pokemmo/playerPanel";

const actorId = new URLSearchParams(window.location.search).get("u");
if (actorId) mountPokemmoPlayer(document.getElementById("root")!, actorId);
