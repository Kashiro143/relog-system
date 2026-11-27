// Tests des règles Realtime Database du K-OS, dans l'émulateur Firebase.
// Lancer : npm test (depuis le dossier firebase/). Nécessite Java.
import { readFileSync } from "node:fs";
import { after, before, beforeEach, describe, test } from "node:test";
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";

let env;

const OWNER = { email: "kashiro@gmail.com", email_verified: true };
const REINDAL = { email: "Reindal.Test@Gmail.com", email_verified: true }; // casse mixte exprès
const STRANGER = { email: "inconnu@gmail.com", email_verified: true };
const UNVERIFIED_OWNER = { email: "kashiro@gmail.com", email_verified: false };

const as = (uid, token) => env.authenticatedContext(uid, token).database();
const anon = () => env.unauthenticatedContext().database();

before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-relog",
    database: { rules: readFileSync("database.rules.json", "utf8"), host: "127.0.0.1", port: 9000 },
  });
});

after(() => env.cleanup());

beforeEach(async () => {
  await env.clearDatabase();
  await env.withSecurityRulesDisabled((ctx) =>
    ctx.database().ref().set({
      auth: {
        owner: "kashiro@gmail,com",
        invites: {
          "kashiro@gmail,com": { actorId: "Kashiro", email: "kashiro@gmail.com", invitedAt: 1 },
          "reindal,test@gmail,com": { actorId: "Reindal", email: "reindal.test@gmail.com", invitedAt: 1 },
        },
      },
      registry: {
        users: {
          Kashiro: { id: "Kashiro", name: "Kashiro", status: "offline", currentMode: "pokemmo" },
          Reindal: { id: "Reindal", name: "Reindal", status: "offline", currentMode: "pokemmo" },
          Titou: { id: "Titou", name: "Titou", status: "offline", currentMode: "idle" },
        },
        modes: { pokemmo: { id: "pokemmo", overlayUrl: "modules/pokemmo/overlay.html" } },
      },
      users: { Reindal: { currentMode: "pokemmo" } },
      terminal: { archives: { a1: { id: "a1", text: "boot" } }, live: { Reindal: { text: "" } } },
      live_data: { Reindal: { pokemmo: { team: { 0: { status: 0 } } } } },
      relog: { overlay: { Titou: { muted: true } } },
      settings: { legacy: true },
    }),
  );
});

describe("overlay OBS (non connecté)", () => {
  test("lit tout ce qu'un overlay affiche", async () => {
    const db = anon();
    for (const path of ["registry/users", "registry/modes/pokemmo", "users/Reindal/currentMode", "terminal/live/Reindal", "live_data/Reindal/pokemmo", "relog/overlay/Reindal/muted"]) {
      await assertSucceeds(db.ref(path).get());
    }
  });
  test("ne lit ni les invitations, ni le propriétaire, ni les archives, ni les anciens nœuds", async () => {
    const db = anon();
    for (const path of ["auth/invites", "auth/invites/reindal,test@gmail,com", "auth/owner", "terminal/archives", "settings", "/"]) {
      await assertFails(db.ref(path).get());
    }
  });
  test("signale sa présence, et rien d'autre", async () => {
    const db = anon();
    await assertSucceeds(db.ref("registry/users/Reindal/status").set("online"));
    await assertSucceeds(db.ref("registry/users/Reindal/status").set("offline"));
    await assertFails(db.ref("registry/users/Reindal/status").set("pwned"));
    await assertFails(db.ref("registry/users/Fantome/status").set("online"));
    await assertFails(db.ref("registry/users/Reindal/name").set("pwned"));
  });
  test("ne peut rien envoyer", async () => {
    const db = anon();
    await assertFails(db.ref("terminal/live/Reindal").set({ text: "hack" }));
    await assertFails(db.ref("live_data/Reindal/pokemmo/team/0/status").set(3));
    await assertFails(db.ref("relog/overlay/Reindal/muted").set(true));
    await assertFails(db.ref("auth/owner").set("pirate@gmail,com"));
  });
});

describe("propriétaire (Kashiro)", () => {
  test("gère membres, modes et invitations", async () => {
    const db = as("k", OWNER);
    await assertSucceeds(db.ref("registry/users/Nouveau").set({ id: "Nouveau", name: "Nouveau" }));
    await assertSucceeds(db.ref("registry/modes/quiz").set({ id: "quiz" }));
    await assertSucceeds(db.ref().update({ "registry/users/Reindal/currentMode": "idle", "users/Reindal/currentMode": "idle" }));
    await assertSucceeds(db.ref("auth/invites").get());
    await assertSucceeds(db.ref("auth/invites/titou@gmail,com").set({ actorId: "Titou", email: "titou@gmail.com", invitedAt: 2 }));
    await assertSucceeds(db.ref("auth/invites/titou@gmail,com").remove());
    await assertSucceeds(db.ref("terminal/archives/a2").set({ id: "a2", text: "x" }));
  });
  test("envoie sur l'overlay de n'importe qui et pilote le PokeMMO", async () => {
    const db = as("k", OWNER);
    await assertSucceeds(db.ref("terminal/live/Reindal").set({ text: "salut", type: "TYPE" }));
    await assertSucceeds(db.ref().update({ "live_data/Reindal/pokemmo/team/0/status": 0, "live_data/Reindal/pokemmo/team/0/timestamp": null }));
  });
  test("une adresse non vérifiée n'a aucun droit", async () => {
    const db = as("k2", UNVERIFIED_OWNER);
    await assertFails(db.ref("registry/modes/quiz").set({ id: "quiz" }));
    await assertFails(db.ref("auth/invites").get());
  });
});

describe("membre invité (Reindal)", () => {
  test("lit sa propre invitation (casse de l'adresse ignorée), pas celles des autres", async () => {
    const db = as("r", REINDAL);
    await assertSucceeds(db.ref("auth/invites/reindal,test@gmail,com").get());
    await assertSucceeds(db.ref("auth/owner").get());
    await assertFails(db.ref("auth/invites/kashiro@gmail,com").get());
    await assertFails(db.ref("auth/invites").get());
  });
  test("pilote son propre PokeMMO et son bouton panique", async () => {
    const db = as("r", REINDAL);
    await assertSucceeds(db.ref("live_data/Reindal/pokemmo/team/0").update({ status: 1, timestamp: 5, history: 1 }));
    await assertSucceeds(db.ref("live_data/Reindal/pokemmo/layout").update({ x: 40 }));
    await assertSucceeds(db.ref("relog/overlay/Reindal/muted").set(true));
    await assertSucceeds(db.ref("terminal/live/Reindal").set({ text: "", type: "RESET" })); // panique alors qu'il est coupé
  });
  test("ne touche pas aux données des autres", async () => {
    const db = as("r", REINDAL);
    await assertFails(db.ref("live_data/Titou/pokemmo/team/0/status").set(3));
    await assertFails(db.ref("relog/overlay/Titou/muted").set(false));
    await assertFails(db.ref("registry/users/Reindal/name").set("Boss"));
    await assertFails(db.ref("users/Reindal/currentMode").set("idle"));
    await assertFails(db.ref("auth/owner").set("reindal,test@gmail,com"));
    await assertFails(db.ref("auth/invites/x@gmail,com").set({ actorId: "Reindal", email: "x@gmail.com" }));
  });
  test("envoie sur l'overlay d'un autre membre, sauf s'il a appuyé sur panique", async () => {
    const db = as("r", REINDAL);
    await assertSucceeds(db.ref("terminal/live/Kashiro").set({ text: "coucou", type: "TYPE" }));
    await assertFails(db.ref("terminal/live/Titou").set({ text: "coucou", type: "TYPE" })); // Titou est coupé
  });
});

describe("compte Google non invité", () => {
  test("n'a aucun droit d'écriture", async () => {
    const db = as("s", STRANGER);
    await assertSucceeds(db.ref("auth/owner").get());
    await assertFails(db.ref("auth/invites/inconnu@gmail,com").set({ actorId: "Titou", email: "inconnu@gmail.com" }));
    await assertFails(db.ref("terminal/live/Reindal").set({ text: "spam" }));
    await assertFails(db.ref("live_data/Reindal/pokemmo/team/0/status").set(3));
    await assertFails(db.ref("terminal/archives").get());
  });
});

describe("revendication du propriétaire", () => {
  test("possible une seule fois, et seulement pour sa propre adresse", async () => {
    await env.withSecurityRulesDisabled((ctx) => ctx.database().ref("auth/owner").remove());
    await assertFails(as("s", STRANGER).ref("auth/owner").set("kashiro@gmail,com"));
    await assertSucceeds(as("k", OWNER).ref("auth/owner").set("kashiro@gmail,com"));
    await assertFails(as("s", STRANGER).ref("auth/owner").set("inconnu@gmail,com"));
  });
});

describe("envoi de GIF", () => {
  const GIF = "https://media.giphy.com/media/abc123/giphy.mp4";
  const gif = (over = {}) => ({ url: GIF, from: "Reindal", fromName: "Reindal", color: "#ffb547", ts: { ".sv": "timestamp" }, ...over });

  beforeEach(() =>
    env.withSecurityRulesDisabled((ctx) =>
      ctx.database().ref("relog/gifs").set({
        Reindal: { k1: { url: GIF, from: "Kashiro", fromName: "Kashiro", color: "#00d4ff", ts: 1 } },
        Titou: { k2: { url: GIF, from: "Kashiro", fromName: "Kashiro", color: "#00d4ff", ts: 1 } },
      }),
    ),
  );

  test("un membre envoie un GIF à un autre, en son nom", async () => {
    await assertSucceeds(as("r", REINDAL).ref("relog/gifs/Kashiro/g1").set(gif({ caption: "gg", preview: "https://media.giphy.com/media/abc123/200w.gif" })));
    await assertSucceeds(anon().ref("relog/gifs/Kashiro").get()); // l'overlay OBS le lit
    await assertSucceeds(as("r", REINDAL).ref("relog/gifs/Kashiro/g2").set(gif({ url: "https://media.giphy.com/media/abc123/giphy.webp", sticker: true })));
    await assertFails(as("r", REINDAL).ref("relog/gifs/Kashiro/g3").set(gif({ sticker: "oui" })));
  });
  test("envoi groupé : tout passe, ou rien si un destinataire a coupé", async () => {
    const db = as("r", REINDAL);
    await assertSucceeds(db.ref().update({ "relog/gifs/Kashiro/m1": gif(), "relog/gifs/Reindal/m2": gif() }));
    await assertFails(db.ref().update({ "relog/gifs/Kashiro/m3": gif(), "relog/gifs/Titou/m4": gif() }));
  });
  test("refuse l'usurpation, les cibles coupées ou inconnues, les liens hors liste et les vieux GIF", async () => {
    const db = as("r", REINDAL);
    await assertFails(db.ref("relog/gifs/Kashiro/x1").set(gif({ from: "Kashiro" })));
    await assertFails(db.ref("relog/gifs/Titou/x2").set(gif()));
    await assertFails(db.ref("relog/gifs/Fantome/x3").set(gif()));
    await assertFails(db.ref("relog/gifs/Kashiro/x4").set(gif({ url: "https://evil.example/track.gif" })));
    await assertFails(db.ref("relog/gifs/Kashiro/x5").set(gif({ url: "http://media.giphy.com/media/abc/giphy.gif" })));
    await assertFails(db.ref("relog/gifs/Kashiro/x6").set(gif({ ts: Date.now() - 120000 })));
    await assertFails(db.ref("relog/gifs/Kashiro/x7").set(gif({ extra: "nope" })));
    await assertFails(db.ref("relog/gifs/Kashiro/x8").set(gif({ caption: "x".repeat(121) })));
  });
  test("personne d'extérieur ne peut envoyer", async () => {
    await assertFails(anon().ref("relog/gifs/Kashiro/a1").set(gif()));
    await assertFails(as("s", STRANGER).ref("relog/gifs/Kashiro/a2").set(gif()));
  });
  test("on supprime ses envois et ce qu'on reçoit, rien d'autre, et on ne réécrit pas un GIF", async () => {
    const db = as("r", REINDAL);
    await assertSucceeds(db.ref("relog/gifs/Kashiro/mine").set(gif()));
    await assertFails(db.ref("relog/gifs/Kashiro/mine").set(gif({ caption: "modifié" })));
    await assertSucceeds(db.ref("relog/gifs/Kashiro/mine").remove());
    await assertSucceeds(db.ref("relog/gifs/Reindal/k1").remove()); // reçu
    await assertFails(db.ref("relog/gifs/Titou/k2").remove()); // ni envoyé ni reçu
  });
});

describe("zone des GIF, favoris et clé GIPHY", () => {
  const FAV = { url: "https://media.giphy.com/media/abc123/giphy.gif", addedAt: 1 };
  test("chacun règle sa zone, dans les limites", async () => {
    const db = as("r", REINDAL);
    await assertSucceeds(db.ref("relog/overlay/Reindal/gifZone").update({ cell: 4, height: 320, seconds: 6 }));
    await assertFails(db.ref("relog/overlay/Reindal/gifZone").update({ cell: 12 }));
    await assertFails(db.ref("relog/overlay/Reindal/gifZone").update({ x: 1 }));
    await assertFails(db.ref("relog/overlay/Titou/gifZone").update({ cell: 0 }));
  });
  test("les favoris sont privés", async () => {
    const db = as("r", REINDAL);
    await assertSucceeds(db.ref("relog/favorites/Reindal/f1").set(FAV));
    await assertSucceeds(db.ref("relog/favorites/Reindal").get());
    await assertFails(db.ref("relog/favorites/Kashiro").get());
    await assertFails(db.ref("relog/favorites/Kashiro/f1").set(FAV));
    await assertFails(db.ref("relog/favorites/Reindal/f2").set({ ...FAV, url: "https://evil.example/a.gif" }));
    await assertFails(anon().ref("relog/favorites/Reindal").get());
  });
  test("la clé GIPHY : Kashiro l'écrit, les invités la lisent", async () => {
    await assertSucceeds(as("k", OWNER).ref("relog/settings/giphyKey").set("abcDEF123"));
    await assertSucceeds(as("r", REINDAL).ref("relog/settings/giphyKey").get());
    await assertFails(as("r", REINDAL).ref("relog/settings/giphyKey").set("pirate"));
    await assertFails(as("s", STRANGER).ref("relog/settings/giphyKey").get());
    await assertFails(anon().ref("relog/settings/giphyKey").get());
  });
});

describe("salons", () => {
  const TS = { ".sv": "timestamp" };
  const stroke = (by = "Reindal") => ({ by, color: "#ffb547", width: 8, pts: "10,10,20,20", fade: 15, ts: TS, done: false });
  const text = (by = "Reindal") => ({ type: "text", by, color: "#ffb547", x: 5000, y: 5000, size: 60, text: "salut", fade: 15, ts: TS, end: 1 });
  const gifItem = (url = "https://media.giphy.com/media/abc123/giphy.mp4") => ({ type: "gif", by: "Reindal", color: "#ffb547", x: 100, y: 100, size: 320, url, fade: 0, ts: TS, end: 1 });
  const cursor = { x: 1, y: 2, ts: TS, on: true, color: "#ffb547", name: "Reindal" };

  beforeEach(() =>
    env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.database();
      await db.ref("relog/rooms").set({
        salon: { name: "Débat", by: "Kashiro", createdAt: 1 },
        autre: { name: "Autre", by: "Reindal", createdAt: 1 },
      });
      await db.ref("relog/overlay/Kashiro/room").set("salon");
      await db.ref("relog/roomContent/salon/strokes/k1").set({ ...stroke("Kashiro"), ts: 1 });
      await db.ref("relog/roomContent/salon/items/k2").set({ ...text("Kashiro"), ts: 1 });
    }),
  );

  test("créer un salon en son nom, le supprimer si on l'a créé", async () => {
    const db = as("r", REINDAL);
    await assertSucceeds(db.ref("relog/rooms/neuf").set({ name: "Neuf", by: "Reindal", createdAt: TS }));
    await assertFails(db.ref("relog/rooms/faux").set({ name: "Faux", by: "Kashiro", createdAt: TS }));
    await assertFails(db.ref("relog/rooms/vide").set({ name: "", by: "Reindal", createdAt: TS }));
    await assertFails(db.ref("relog/rooms/salon").remove()); // créé par Kashiro
    await assertSucceeds(db.ref().update({ "relog/rooms/autre": null, "relog/roomContent/autre": null }));
    await assertFails(anon().ref("relog/rooms/x").set({ name: "X", by: "Reindal", createdAt: TS }));
  });

  test("rejoindre un salon existant seulement", async () => {
    const db = as("r", REINDAL);
    await assertSucceeds(db.ref("relog/overlay/Reindal/room").set("salon"));
    await assertFails(db.ref("relog/overlay/Reindal/room").set("inexistant"));
    await assertFails(db.ref("relog/overlay/Titou/room").set("salon"));
    await assertSucceeds(db.ref("relog/overlay/Reindal/room").remove());
  });

  test("il faut avoir rejoint le salon pour y dessiner, écrire ou poser un GIF", async () => {
    const db = as("r", REINDAL);
    await assertFails(db.ref("relog/roomContent/salon/strokes/s1").set(stroke()));
    await assertSucceeds(db.ref("relog/overlay/Reindal/room").set("salon"));
    await assertSucceeds(db.ref("relog/roomContent/salon/strokes/s1").set(stroke()));
    await assertSucceeds(db.ref("relog/roomContent/salon/strokes/s1").update({ pts: "10,10,20,20,30,30", done: true, end: 5 }));
    await assertSucceeds(db.ref("relog/roomContent/salon/items/t1").set(text()));
    await assertSucceeds(db.ref("relog/roomContent/salon/items/g1").set(gifItem()));
    await assertSucceeds(db.ref("relog/roomContent/salon/items/g9").set({ ...gifItem("https://media.giphy.com/media/abc123/giphy.webp"), sticker: true }));
    await assertSucceeds(db.ref("relog/roomContent/salon/items/t1").update({ x: 100, y: 200 }));
    await assertSucceeds(db.ref("relog/roomContent/salon/cursors/Reindal").set(cursor));
    await assertFails(db.ref("relog/roomContent/autre/strokes/s2").set(stroke())); // pas dans ce salon
  });

  test("refuse l'usurpation, la modification des éléments des autres et les contenus invalides", async () => {
    const db = as("r", REINDAL);
    await assertSucceeds(db.ref("relog/overlay/Reindal/room").set("salon"));
    await assertFails(db.ref("relog/roomContent/salon/strokes/s3").set(stroke("Kashiro")));
    await assertFails(db.ref("relog/roomContent/salon/strokes/k1").update({ pts: "1,1" }));
    await assertFails(db.ref("relog/roomContent/salon/items/k2").update({ x: 1 }));
    await assertFails(db.ref("relog/roomContent/salon/items/g2").set(gifItem("https://evil.example/a.gif")));
    const { text: _omit, ...noText } = text();
    await assertFails(db.ref("relog/roomContent/salon/items/t2").set(noText)); // texte sans texte
    await assertFails(db.ref("relog/roomContent/salon/items/t3").set({ ...text(), x: 20000 }));
    await assertFails(db.ref("relog/roomContent/salon/strokes/s4").set({ ...stroke(), width: 500 }));
    await assertFails(db.ref("relog/roomContent/salon/cursors/Kashiro").set({ ...cursor, name: "Kashiro" }));
    await assertFails(db.ref("relog/roomContent/salon/bidon").set({ a: 1 }));
  });

  test("un participant peut effacer ce qu'il y a dans le salon ; le contenu est public en lecture", async () => {
    const db = as("r", REINDAL);
    await assertSucceeds(db.ref("relog/overlay/Reindal/room").set("salon"));
    await assertSucceeds(db.ref().update({ "relog/roomContent/salon/strokes/k1": null, "relog/roomContent/salon/items/k2": null }));
    await assertSucceeds(anon().ref("relog/roomContent/salon").get());
    await assertFails(anon().ref("relog/roomContent/salon/strokes/z").set(stroke()));
    await assertFails(as("s", STRANGER).ref("relog/roomContent/salon/strokes/z").set(stroke()));
  });
});
