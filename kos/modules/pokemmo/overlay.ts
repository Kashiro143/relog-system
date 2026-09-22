import { mountPokemmoOverlay } from "../../src/modules/pokemmo/overlayDisplay";

const actorId = new URLSearchParams(window.location.search).get("u");
if (actorId) mountPokemmoOverlay(document.getElementById("root")!, actorId);
