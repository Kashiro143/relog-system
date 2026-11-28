import { watchMyRoom, watchStrokes, watchItems, watchCursors } from "./room";
import { createRoomView } from "./roomView";
import { createVideoLayer } from "./videoLayer";
import { watchMyParty, watchVideo, watchVolume } from "./watch";
import { watchActors } from "../registry";
import type { Unsubscribe } from "firebase/database";

/**
 * Overlay OBS : le salon de dessin rejoint (dessins / textes / GIF, dessus) et,
 * indépendamment, la vidéo de la watch-party rejointe (dessous).
 */
export function mountRoomDisplay(root: HTMLElement, videoRoot: HTMLElement, actorId: string): { setMuted(muted: boolean): void } {
  const view = createRoomView(root);
  const video = createVideoLayer(videoRoot);
  let actors: Record<string, { color?: string; name?: string }> = {};
  let roomStops: Unsubscribe[] = [];
  let partyStop: Unsubscribe | null = null;

  watchActors((data) => {
    actors = data;
  });
  watchVolume(actorId, (v) => video.setVolume(v));

  watchMyRoom(actorId, (room) => {
    roomStops.forEach((stop) => stop());
    roomStops = [];
    view.clear();
    if (!room) return;
    roomStops = [
      watchStrokes(room, (m) => view.setStrokes(m)),
      watchItems(room, (m) => view.setItems(m)),
      watchCursors(room, (c) => view.setCursors(c)),
    ];
  });

  watchMyParty(actorId, (party) => {
    partyStop?.();
    partyStop = null;
    video.setVideo(null);
    if (!party) return;
    partyStop = watchVideo(party, (v) => video.setVideo(v, v ? { color: actors[v.by]?.color, name: actors[v.by]?.name || v.by } : undefined));
  });

  // Bouton panique : la couche est masquée, mais le son de la vidéo doit aussi se couper.
  return { setMuted: (muted) => video.setMuted(muted) };
}
