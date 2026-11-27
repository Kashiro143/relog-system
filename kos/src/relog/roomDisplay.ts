import { watchMyRoom, watchStrokes, watchItems, watchCursors } from "./room";
import { createRoomView } from "./roomView";
import { createVideoLayer } from "./videoLayer";
import { watchVideo, watchVolume } from "./watch";
import { watchActors } from "../registry";
import type { Unsubscribe } from "firebase/database";

/**
 * Overlay OBS : affiche le salon que le membre a rejoint (rien s'il n'est dans
 * aucun salon) : la vidéo de la watch-party dessous, dessins / textes / GIF dessus.
 */
export function mountRoomDisplay(root: HTMLElement, videoRoot: HTMLElement, actorId: string): { setMuted(muted: boolean): void } {
  const view = createRoomView(root);
  const video = createVideoLayer(videoRoot);
  let colors: Record<string, string> = {};
  let stops: Unsubscribe[] = [];

  watchActors((actors) => {
    colors = Object.fromEntries(Object.values(actors).filter((a) => a?.id).map((a) => [a.id, a.color]));
  });
  watchVolume(actorId, (v) => video.setVolume(v));

  watchMyRoom(actorId, (room) => {
    stops.forEach((stop) => stop());
    stops = [];
    view.clear();
    video.setVideo(null);
    if (!room) return;
    stops = [
      watchStrokes(room, (m) => view.setStrokes(m)),
      watchItems(room, (m) => view.setItems(m)),
      watchCursors(room, (c) => view.setCursors(c)),
      watchVideo(room, (v) => video.setVideo(v, v ? colors[v.by] : undefined)),
    ];
  });

  // Bouton panique : la couche est masquée, mais le son de la vidéo doit aussi se couper.
  return { setMuted: (muted) => video.setMuted(muted) };
}
