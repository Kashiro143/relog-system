import { ref, set, remove, onValue, onChildAdded, onChildChanged, onDisconnect, serverTimestamp, type Unsubscribe } from "firebase/database";
import { db } from "../firebase";

// Partage d'écran entre les membres d'un salon, en pair à pair (WebRTC).
// Firebase ne sert qu'à se présenter (signalisation) :
// relog/roomContent/{salon}/screen       : { by, startedAt }  qui partage
// relog/roomContent/{salon}/rtc/{membre} : { req, sharer, offer, answer }
// Chaque spectateur demande (req) ; le partageur répond par une offre, le
// spectateur par une réponse. Les candidats réseau sont inclus dans l'offre et
// la réponse (pas d'échange au fil de l'eau) : plus simple, un peu plus lent.

const ICE: RTCConfiguration = { iceServers: [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }] };

/** Attend la fin de la collecte des candidats réseau (au plus 3 s). */
function gathered(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      pc.removeEventListener("icegatheringstatechange", check);
      clearTimeout(timer);
      resolve();
    };
    const check = () => pc.iceGatheringState === "complete" && done();
    const timer = setTimeout(done, 3000);
    pc.addEventListener("icegatheringstatechange", check);
  });
}

const pack = (d: RTCSessionDescription | null) => JSON.stringify({ type: d?.type, sdp: d?.sdp });
const unpack = (s: string): RTCSessionDescriptionInit => JSON.parse(s);

export interface ScreenShareEvents {
  /** Écran reçu d'un autre membre (null : plus rien à afficher). */
  onRemote(stream: MediaStream | null, sharer: string | null): void;
  /** Qui partage dans ce salon (null : personne). */
  onSharer(sharer: string | null): void;
  onError(message: string): void;
}

export interface ScreenShare {
  /** Partage mon écran au salon. Rejette si l'utilisateur annule. */
  start(): Promise<MediaStream>;
  stop(): void;
  readonly sharing: boolean;
  destroy(): void;
}

export function createScreenShare(room: string, me: string, ev: ScreenShareEvents): ScreenShare {
  const base = `relog/roomContent/${room}`;
  const screenRef = ref(db, `${base}/screen`);
  const rtcBase = ref(db, `${base}/rtc`);
  const myRtc = ref(db, `${base}/rtc/${me}`);
  const stops: Unsubscribe[] = [];

  // ----- Côté partageur -----
  let stream: MediaStream | null = null;
  const outgoing = new Map<string, RTCPeerConnection>();
  let rtcStops: Unsubscribe[] = [];

  async function offerTo(viewer: string) {
    if (!stream) return;
    outgoing.get(viewer)?.close();
    const pc = new RTCPeerConnection(ICE);
    outgoing.set(viewer, pc);
    stream.getTracks().forEach((t) => pc.addTrack(t, stream!));
    await pc.setLocalDescription(await pc.createOffer());
    await gathered(pc);
    if (outgoing.get(viewer) !== pc || !stream) return;
    await set(ref(db, `${base}/rtc/${viewer}/offer`), pack(pc.localDescription)).catch(() => {});
  }

  function onViewer(snap: { key: string | null; val(): any }) {
    const viewer = snap.key;
    const v = snap.val();
    if (!viewer || viewer === me || !v || v.sharer !== me || !stream) return;
    if (!v.offer) offerTo(viewer).catch(() => {}); // nouvelle demande (ou page rechargée)
    else if (v.answer) {
      const pc = outgoing.get(viewer);
      if (pc && pc.signalingState === "have-local-offer") pc.setRemoteDescription(unpack(v.answer)).catch(() => {});
    }
  }

  function stopSharing() {
    rtcStops.forEach((s) => s());
    rtcStops = [];
    outgoing.forEach((pc) => pc.close());
    outgoing.clear();
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
  }

  // ----- Côté spectateur -----
  let incoming: RTCPeerConnection | null = null;
  let watching: string | null = null;
  let offerStop: Unsubscribe | null = null;

  function closeIncoming() {
    offerStop?.();
    offerStop = null;
    incoming?.close();
    incoming = null;
    if (watching) ev.onRemote(null, null);
    watching = null;
  }

  async function watch(sharer: string) {
    closeIncoming();
    watching = sharer;
    onDisconnect(myRtc).remove();
    await set(myRtc, { req: serverTimestamp(), sharer }).catch(() => ev.onError("Impossible de demander l'écran partagé."));
    let handled = "";
    offerStop = onValue(ref(db, `${base}/rtc/${me}/offer`), async (snap) => {
      const offer = snap.val();
      if (typeof offer !== "string" || offer === handled || watching !== sharer) return;
      handled = offer;
      incoming?.close();
      const pc = new RTCPeerConnection(ICE);
      incoming = pc;
      pc.ontrack = (e) => ev.onRemote(e.streams[0] ?? new MediaStream([e.track]), sharer);
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "failed") ev.onError("Connexion à l'écran partagé impossible (réseau trop restrictif ?).");
      };
      try {
        await pc.setRemoteDescription(unpack(offer));
        await pc.setLocalDescription(await pc.createAnswer());
        await gathered(pc);
        if (incoming !== pc) return;
        await set(ref(db, `${base}/rtc/${me}/answer`), pack(pc.localDescription));
      } catch {
        ev.onError("Écran partagé illisible.");
      }
    });
  }

  // Qui partage ? On suit le nœud "screen" du salon.
  stops.push(
    onValue(screenRef, (snap) => {
      const by: string | null = snap.val()?.by ?? null;
      ev.onSharer(by);
      if (stream && by !== me) {
        // Quelqu'un a pris la main : on arrête notre partage.
        stopSharing();
      }
      if (by && by !== me) {
        if (watching !== by) watch(by).catch(() => {});
      } else {
        closeIncoming();
        remove(myRtc).catch(() => {});
      }
    }),
  );

  return {
    get sharing() {
      return !!stream;
    },
    async start() {
      if (!navigator.mediaDevices?.getDisplayMedia) throw new Error("Ce navigateur ne permet pas de capturer l'écran (utilise Chrome ou Edge).");
      const s = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: false });
      stopSharing();
      stream = s;
      s.getVideoTracks()[0]?.addEventListener("ended", () => this.stop());
      onDisconnect(screenRef).remove();
      await set(screenRef, { by: me, startedAt: serverTimestamp() });
      rtcStops = [onChildAdded(rtcBase, onViewer), onChildChanged(rtcBase, onViewer)];
      return s;
    },
    stop() {
      const was = !!stream;
      const viewers = [...outgoing.keys()];
      stopSharing();
      if (was) {
        remove(screenRef).catch(() => {});
        // Les règles n'autorisent que l'effacement entrée par entrée.
        viewers.forEach((v) => remove(ref(db, `${base}/rtc/${v}`)).catch(() => {}));
        onDisconnect(screenRef).cancel();
      }
    },
    destroy() {
      this.stop();
      closeIncoming();
      remove(myRtc).catch(() => {});
      onDisconnect(myRtc).cancel();
      stops.forEach((s) => s());
    },
  };
}
