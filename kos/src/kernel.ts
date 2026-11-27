import { ref, onValue, set, onDisconnect } from "firebase/database";
import { db } from "./firebase";
import { appUrl } from "./appUrl";
import type { Role } from "./types";

export interface KernelOptions {
  container: HTMLIFrameElement;
  /** Acteur imposé par la page (ex: player connecté) ; sinon lu dans ?u=. */
  actorId?: string;
  onModeChange?: (modeId: string) => void;
}

/**
 * Noyau partagé par overlay.html et player.html : identifie l'acteur via
 * ?u=<id>, signale sa présence (heartbeat), et charge dynamiquement le
 * module correspondant au mode actif depuis registry/modes/{modeId}
 * (défini via la Forge) plutôt qu'une convention de chemin figée.
 */
export class Kernel {
  readonly actorId: string;
  readonly role: Role;
  private container: HTMLIFrameElement;

  constructor(role: Role, options: KernelOptions) {
    this.role = role;
    this.actorId = options.actorId ?? new URLSearchParams(window.location.search).get("u") ?? "";
    this.container = options.container;

    if (!this.actorId) {
      console.warn("[K-OS] Aucun acteur (?u=...) spécifié dans l'URL.");
      return;
    }

    this.announcePresence();
    this.listenForModeChanges(options.onModeChange);
  }

  private announcePresence() {
    // Master lit la présence dans registry/users, pas dans users/.
    const statusRef = ref(db, `registry/users/${this.actorId}/status`);
    set(statusRef, "online");
    onDisconnect(statusRef).set("offline");
  }

  private listenForModeChanges(onModeChange?: (modeId: string) => void) {
    onValue(ref(db, `users/${this.actorId}/currentMode`), (snapshot) => {
      const modeId = snapshot.val();
      if (!modeId) return;
      this.loadModule(modeId);
      onModeChange?.(modeId);
    });
  }

  private loadModule(modeId: string) {
    onValue(
      ref(db, `registry/modes/${modeId}`),
      (snapshot) => {
        const mode = snapshot.val();
        const url = this.role === "overlay" ? mode?.overlayUrl : mode?.playerUrl;
        if (url) this.container.src = `${appUrl(url)}?u=${encodeURIComponent(this.actorId)}`;
      },
      { onlyOnce: true },
    );
  }
}
