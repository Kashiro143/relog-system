import { Kernel } from "../kernel";

// Source OBS dédiée au module (ex. équipe PokeMMO) : suit le mode choisi dans
// Groupe, y compris « Aucun ». La présence reste gérée par l'overlay Re:log.
const container = document.getElementById("module-container") as HTMLIFrameElement;
new Kernel("overlay", { container, presence: false });
