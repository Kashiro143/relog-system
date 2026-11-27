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
