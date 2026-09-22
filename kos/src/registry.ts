import { ref, onValue, set, update, remove } from "firebase/database";
import type { Unsubscribe } from "firebase/database";
import { db } from "./firebase";
import type { Actor, ModuleDefinition } from "./types";

export function watchActors(callback: (actors: Record<string, Actor>) => void): Unsubscribe {
  return onValue(ref(db, "registry/users"), (snap) => callback(snap.val() ?? {}));
}

export function watchModes(callback: (modes: Record<string, ModuleDefinition>) => void): Unsubscribe {
  return onValue(ref(db, "registry/modes"), (snap) => callback(snap.val() ?? {}));
}

export function createActor(actor: Actor) {
  return set(ref(db, `registry/users/${actor.id}`), actor);
}

export function deleteActor(id: string) {
  return remove(ref(db, `registry/users/${id}`));
}

export function createMode(mode: ModuleDefinition) {
  return set(ref(db, `registry/modes/${mode.id}`), mode);
}

export function deleteMode(id: string) {
  return remove(ref(db, `registry/modes/${id}`));
}

export function setActorMode(actorId: string, modeId: string) {
  const updates: Record<string, unknown> = {};
  updates[`registry/users/${actorId}/currentMode`] = modeId;
  updates[`users/${actorId}/currentMode`] = modeId;
  return update(ref(db), updates);
}
