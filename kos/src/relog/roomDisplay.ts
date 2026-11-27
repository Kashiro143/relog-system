import { watchMyRoom, watchStrokes, watchItems, watchCursors } from "./room";
import { createRoomView } from "./roomView";
import type { Unsubscribe } from "firebase/database";

/** Overlay OBS : affiche le salon que le membre a rejoint (rien s'il n'est dans aucun salon). */
export function mountRoomDisplay(root: HTMLElement, actorId: string) {
  const view = createRoomView(root);
  let stops: Unsubscribe[] = [];

  watchMyRoom(actorId, (room) => {
    stops.forEach((stop) => stop());
    stops = [];
    view.clear();
    if (!room) return;
    stops = [
      watchStrokes(room, (m) => view.setStrokes(m)),
      watchItems(room, (m) => view.setItems(m)),
      watchCursors(room, (c) => view.setCursors(c)),
    ];
  });
}
