import { ref, onValue, set, remove } from "firebase/database";
import type { Unsubscribe } from "firebase/database";
import { db } from "../../firebase";

// La bibliothèque d'archives (lore) est un contenu partagé, écrit par
// Kashiro. Le flux "live" (le message actuellement affiché) est en
// revanche par acteur : Kashiro peut envoyer un signal vers l'overlay
// de n'importe quel membre du Re:log (le virus s'infiltre ailleurs),
// et sa propre boucle "starting soon" cible simplement son propre id.

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

export function watchArchives(callback: (archives: Record<string, Archive>) => void): Unsubscribe {
  return onValue(ref(db, "terminal/archives"), (snap) => callback(snap.val() ?? {}));
}

export function saveArchive(archive: Archive) {
  return set(ref(db, `terminal/archives/${archive.id}`), archive);
}

export function deleteArchive(id: string) {
  return remove(ref(db, `terminal/archives/${id}`));
}

export function watchLive(actorId: string, callback: (state: LiveState) => void): Unsubscribe {
  return onValue(ref(db, `terminal/live/${actorId}`), (snap) => callback(snap.val() ?? EMPTY_LIVE));
}

export function dispatchLive(actorId: string, patch: Partial<Omit<LiveState, "timestamp">>) {
  const state: LiveState = { ...EMPTY_LIVE, ...patch, timestamp: Date.now() };
  return set(ref(db, `terminal/live/${actorId}`), state);
}

export function resetLive(actorId: string) {
  return dispatchLive(actorId, { type: "RESET", text: "", raid: false });
}
