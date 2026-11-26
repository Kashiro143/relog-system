import { ref, onValue, set } from "firebase/database";
import type { Unsubscribe } from "firebase/database";
import { db } from "../firebase";
import { resetLive } from "../modules/terminal/data";

// Bouton panique : un membre coupe tout ce que les autres affichent sur son
// overlay Re:log (signaux, et plus tard GIF, dessins, vidéos). Son propre
// module (ex: PokeMMO) reste visible.

export function watchMuted(actorId: string, callback: (muted: boolean) => void): Unsubscribe {
  return onValue(ref(db, `relog/overlay/${actorId}/muted`), (snap) => callback(snap.val() === true));
}

export async function panic(actorId: string) {
  await set(ref(db, `relog/overlay/${actorId}/muted`), true);
  await resetLive(actorId);
}

export function unmute(actorId: string) {
  return set(ref(db, `relog/overlay/${actorId}/muted`), false);
}
