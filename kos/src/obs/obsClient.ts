// Client minimal pour obs-websocket v5 (intégré à OBS 28+, Outils → Paramètres
// du serveur WebSocket). Le mot de passe ne quitte pas ce navigateur : il sert
// seulement à calculer la réponse au défi envoyé par OBS.

export class ObsError extends Error {
  readonly code?: number;
  constructor(message: string, code?: number) {
    super(message);
    this.code = code;
  }
}

interface Pending {
  resolve: (data: any) => void;
  reject: (err: Error) => void;
}

async function sha256b64(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return btoa(String.fromCharCode(...new Uint8Array(digest)));
}

export class ObsClient {
  private ws: WebSocket | null = null;
  private pending = new Map<string, Pending>();
  private seq = 0;
  onClose?: () => void;

  /** Se connecte et s'identifie. Rejette avec un message en français si ça échoue. */
  connect(port: number, password: string, timeoutMs = 6000): Promise<{ obsVersion: string }> {
    this.close();
    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = (msg: string, code?: number) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.close();
        reject(new ObsError(msg, code));
      };
      const timer = setTimeout(() => fail("OBS ne répond pas. Vérifie qu'OBS est ouvert et que le serveur WebSocket est activé."), timeoutMs);
      let ws: WebSocket;
      try {
        ws = new WebSocket(`ws://127.0.0.1:${port}`);
      } catch {
        return fail("Connexion impossible : port invalide ?");
      }
      this.ws = ws;
      let obsVersion = "";
      ws.onerror = () =>
        fail(
          "Connexion refusée. Vérifie qu'OBS est ouvert, que le serveur WebSocket est activé et le port. " +
            "Si ton navigateur demande l'accès aux « appareils du réseau local », autorise-le ; sinon ouvre cette page en dock dans OBS.",
        );
      ws.onclose = (e) => {
        if (!settled) {
          if (e.code === 4009) fail("Mot de passe incorrect.", 4009);
          else fail("OBS a fermé la connexion.", e.code);
          return;
        }
        this.ws = null;
        for (const p of this.pending.values()) p.reject(new ObsError("Connexion à OBS perdue."));
        this.pending.clear();
        this.onClose?.();
      };
      ws.onmessage = async (ev) => {
        let msg: { op: number; d: any };
        try {
          msg = JSON.parse(String(ev.data));
        } catch {
          return;
        }
        if (msg.op === 0) {
          obsVersion = msg.d.obsWebSocketVersion ?? "";
          const identify: Record<string, unknown> = { rpcVersion: 1, eventSubscriptions: 0 };
          const auth = msg.d.authentication;
          if (auth) {
            if (!password) return fail("OBS demande un mot de passe : copie-le depuis Outils → Paramètres du serveur WebSocket → Afficher les infos de connexion.");
            const secret = await sha256b64(password + auth.salt);
            identify.authentication = await sha256b64(secret + auth.challenge);
          }
          ws.send(JSON.stringify({ op: 1, d: identify }));
        } else if (msg.op === 2) {
          settled = true;
          clearTimeout(timer);
          resolve({ obsVersion });
        } else if (msg.op === 7) {
          const p = this.pending.get(msg.d.requestId);
          if (!p) return;
          this.pending.delete(msg.d.requestId);
          const st = msg.d.requestStatus;
          if (st?.result) p.resolve(msg.d.responseData ?? {});
          else p.reject(new ObsError(st?.comment || `Requête ${msg.d.requestType} refusée`, st?.code));
        }
      };
    });
  }

  get connected() {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  request<T = any>(requestType: string, requestData?: Record<string, unknown>): Promise<T> {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return Promise.reject(new ObsError("Pas connecté à OBS."));
    const requestId = `k${++this.seq}`;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      ws.send(JSON.stringify({ op: 6, d: { requestType, requestId, requestData } }));
    });
  }

  close() {
    const ws = this.ws;
    this.ws = null;
    if (ws && ws.readyState <= WebSocket.OPEN) ws.close();
  }
}
