import { ref, onValue, set, remove } from "firebase/database";
import type { Unsubscribe } from "firebase/database";
import { db } from "../../firebase";

// Outil solo : ce module n'appartient qu'à Kashiro (pas de sélection
// d'acteur, pas de passage par le registre Forge/Master). Voir la Forge
// pour les modes partagés par le groupe (ex: PokeMMO).

export interface Archive {
  id: string;
  label: string;
  text: string;
  raid: boolean;
}

export type Skin = "classic" | "techwear";

export interface LiveState {
  text: string;
  raid: boolean;
  type: "TYPE" | "RESET";
  skin: Skin;
  timestamp: number;
}

const EMPTY_LIVE: LiveState = { text: "", raid: false, type: "RESET", skin: "classic", timestamp: 0 };
const LIVE_PATH = "terminal/live";

export function watchArchives(callback: (archives: Record<string, Archive>) => void): Unsubscribe {
  return onValue(ref(db, "terminal/archives"), (snap) => callback(snap.val() ?? {}));
}

export function saveArchive(archive: Archive) {
  return set(ref(db, `terminal/archives/${archive.id}`), archive);
}

export function deleteArchive(id: string) {
  return remove(ref(db, `terminal/archives/${id}`));
}

export function watchLive(callback: (state: LiveState) => void): Unsubscribe {
  return onValue(ref(db, LIVE_PATH), (snap) => callback(snap.val() ?? EMPTY_LIVE));
}

export function dispatchLive(patch: Partial<Omit<LiveState, "timestamp">>) {
  const state: LiveState = { ...EMPTY_LIVE, ...patch, timestamp: Date.now() };
  return set(ref(db, LIVE_PATH), state);
}

export function resetLive() {
  return dispatchLive({ type: "RESET", text: "", raid: false });
}
