import "../theme.css";
import { ref, onValue } from "firebase/database";
import { db } from "../firebase";
import { requireMember } from "../auth";
import { watchActors } from "../registry";
import { watchRooms } from "../relog/room";
import { appUrl } from "../appUrl";
import type { Actor } from "../types";

const member = await requireMember();
const me = member.actorId;
const $ = (id: string) => document.getElementById(id)!;

// ---------- Liens OBS ----------

interface LinkDef {
  title: string;
  hint: string;
  url: string;
}

const links: LinkDef[] = [];
if (me) {
  const u = encodeURIComponent(me);
  links.push(
    { title: "Overlay Re:log", hint: "Source Navigateur 1920 × 1080 — GIF, salons, signaux, module", url: `${appUrl("overlay.html")}?u=${u}` },
    { title: "Mon player", hint: "Dock ou navigateur — module et bouton panique", url: `${appUrl("player.html")}?u=${u}` },
  );
  ($("tool-player") as HTMLAnchorElement).href = `player.html?u=${u}`;
}
links.push(
  { title: "Console GIF", hint: "Dock — envoyer des GIF", url: appUrl("relog.html") },
  { title: "Salons", hint: "Dock ou navigateur — dessin, watch-party", url: appUrl("room.html") },
);
if (member.isOwner) {
  links.push(
    { title: "Terminal (overlay)", hint: "Source Navigateur — messages du virus", url: appUrl("modules/terminal/overlay.html") },
    { title: "Starting soon (écran)", hint: "Source Navigateur — version en ligne de l'outil autonome", url: appUrl("starting-soon/display.html") },
    { title: "Starting soon (panneau)", hint: "Dock — à associer à l'écran en ligne ci-dessus", url: appUrl("starting-soon/controller.html") },
  );
}

const box = $("links");
for (const l of links) {
  const row = document.createElement("div");
  row.className = "link-row";
  row.innerHTML = `<div class="what"><b></b><small></small></div><div class="field"><input readonly aria-label="" /><button>Copier</button></div>`;
  row.querySelector("b")!.textContent = l.title;
  row.querySelector("small")!.textContent = l.hint;
  const input = row.querySelector("input")!;
  input.value = l.url;
  input.setAttribute("aria-label", `Lien : ${l.title}`);
  input.addEventListener("focus", () => input.select());
  const btn = row.querySelector("button")!;
  btn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(l.url);
    } catch {
      input.select();
      document.execCommand("copy");
    }
    btn.textContent = "Copié ✓";
    setTimeout(() => (btn.textContent = "Copier"), 1200);
  });
  box.appendChild(row);
}

$("owner-tools").hidden = !member.isOwner;

// ---------- État ----------

let actor: Actor | undefined;
let overlay: { muted?: boolean; room?: string } = {};
let rooms: Record<string, { name: string }> = {};

function pill(kind: "ok" | "warn" | "", html: string) {
  const el = document.createElement("span");
  el.className = `pill ${kind}`;
  el.innerHTML = `<span class="dot"></span><span>${html}</span>`;
  return el;
}

function renderStatus() {
  const row = $("status");
  row.replaceChildren();
  if (!me) {
    row.appendChild(pill("warn", "Ton adresse n'est liée à aucun membre : demande une invitation à Kashiro."));
    return;
  }
  $("hello").textContent = `Salut ${actor?.name ?? me}`;
  row.appendChild(actor?.status === "online" ? pill("ok", "Overlay OBS <b>ouvert</b>") : pill("", "Overlay OBS <b>fermé</b>"));
  if (overlay.muted) row.appendChild(pill("warn", "🛑 Overlay Re:log <b>coupé</b> — réactive-le depuis ton player"));
  const room = overlay.room && rooms[overlay.room];
  row.appendChild(room ? pill("ok", `Dans le salon <b></b>`) : pill("", "Dans aucun salon"));
  if (room) row.lastElementChild!.querySelector("b")!.textContent = room.name;
}

if (me) {
  watchActors((actors) => {
    actor = actors[me];
    renderStatus();
  });
  onValue(ref(db, `relog/overlay/${me}`), (snap) => {
    overlay = snap.val() ?? {};
    renderStatus();
  });
  watchRooms((data) => {
    rooms = data;
    renderStatus();
  });
}
renderStatus();
