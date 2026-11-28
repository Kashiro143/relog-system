import { ref, onValue } from "firebase/database";
import { db } from "../firebase";
import { appUrl } from "../appUrl";
import { watchActors } from "../registry";
import type { Member } from "../auth";

// Barre de navigation commune à toutes les pages connectées du K-OS.
// En dock OBS étroit, elle se réduit aux icônes.

interface NavItem {
  page: string;
  href: string;
  icon: string;
  label: string;
  title: string;
}

const STYLE = `
.kos-shell { position: sticky; top: 0; z-index: 50; display: flex; align-items: center; gap: 6px; padding: 0 14px; height: var(--shell-h); background: rgba(0, 0, 0, 0.72); backdrop-filter: blur(8px); border-bottom: 1px solid rgba(0, 212, 255, 0.35); }
.kos-shell .brand { font: 400 13px var(--font-display); letter-spacing: 5px; color: #fff; text-decoration: none; padding: 6px 12px 6px 0; margin-right: 6px; white-space: nowrap; }
.kos-shell .brand b { font-weight: 400; color: var(--accent-neon); letter-spacing: 1px; margin-left: 4px; }
.kos-shell .links { display: flex; align-items: center; gap: 2px; flex: 1; min-width: 0; overflow-x: auto; scrollbar-width: none; }
.kos-shell .links::-webkit-scrollbar { display: none; }
.kos-shell .links a { position: relative; display: inline-flex; align-items: center; gap: 7px; padding: 7px 14px; color: var(--text-dim); text-decoration: none; font-size: 12.5px; font-weight: 600; white-space: nowrap; clip-path: polygon(7px 0, 100% 0, calc(100% - 7px) 100%, 0 100%); transition: color .15s, background .15s; }
.kos-shell .links a:hover { color: #fff; background: rgba(0, 212, 255, 0.14); }
.kos-shell .links a[aria-current="page"] { color: #00102a; background: var(--accent-neon); }
.kos-shell .links .sep { width: 1px; height: 18px; background: var(--border-strong); margin: 0 8px; flex: none; }
.kos-shell .links .grp { font: 400 9px var(--font-display); letter-spacing: 2px; text-transform: uppercase; color: var(--text-faint); padding: 0 4px 0 2px; white-space: nowrap; }
.kos-shell .me { display: flex; align-items: center; gap: 8px; flex: none; font-size: 13px; }
.kos-shell .me .dot { width: 9px; height: 9px; border-radius: 50%; background: var(--c, var(--accent-neon)); box-shadow: 0 0 8px var(--c, var(--accent-neon)); }
.kos-shell .me .name { font-weight: 700; max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.kos-shell .me .role { font-size: 11px; color: var(--text-dim); }
.kos-shell .me button { padding: 6px 10px; font-size: 12px; }
@media (max-width: 1240px) { .kos-shell .links .grp, .kos-shell .me .role { display: none; } }
@media (max-width: 1080px) {
  .kos-shell .links a .t { display: none; }
  .kos-shell .links a { padding: 7px 11px; font-size: 16px; }
}
@media (max-width: 520px) {
  .kos-shell .me .name, .kos-shell .me .out-t { display: none; }
  .kos-shell .brand { letter-spacing: 2px; }
  .kos-shell .brand b { display: none; }
}

.kos-status { position: fixed; left: 0; right: 0; bottom: 0; z-index: 50; height: var(--status-h); display: flex; align-items: center; gap: 16px; padding-right: max(14px, env(safe-area-inset-right, 0px)); background: #000; font: 11px var(--font-mono); color: var(--text-dim); }
.kos-status .pw { position: relative; flex: none; width: 56px; height: 100%; background: #000; clip-path: polygon(0 0, 100% 0, calc(100% - 10px) 100%, 0 100%); border-right: 1px solid rgba(0,212,255,0.4); }
.kos-status .pw::before { content: ""; position: absolute; left: 18px; top: 8px; width: 13px; height: 13px; border: 2px solid var(--accent-neon); border-radius: 50%; border-top-color: transparent; filter: drop-shadow(0 0 4px var(--accent-neon)); }
.kos-status .pw::after { content: ""; position: absolute; left: 24px; top: 5px; width: 2px; height: 8px; background: var(--accent-neon); }
.kos-status .net.ok { color: var(--status-online); }
.kos-status .net.bad { color: var(--status-offline); }
.kos-status .push { margin-left: auto; }
.kos-status .clock { color: #fff; font-variant-numeric: tabular-nums; }
@media (max-width: 520px) { .kos-status .ver { display: none; } }

.kos-boot { position: fixed; inset: 0; z-index: 200; display: grid; place-items: center; background: radial-gradient(120% 90% at 20% 0%, #0d2cf0, #030a6e 60%, #020652); cursor: pointer; transition: opacity .35s, visibility .35s; }
.kos-boot.done { opacity: 0; visibility: hidden; }
.kos-boot .box { position: relative; width: min(460px, calc(100vw - 32px)); background: rgba(3,8,52,0.85); padding: 34px 22px 20px; }
.kos-boot .box::after { content: ""; position: absolute; inset: 5px -5px -5px 5px; border: 1px solid rgba(0,212,255,0.7); border-left: 0; border-top: 0; }
.kos-boot .tab { position: absolute; left: 0; top: -14px; background: #000; color: #fff; font: 400 13px var(--font-display); letter-spacing: 7px; padding: 7px 14px; }
.kos-boot .tab::after { content: ""; display: inline-block; width: 44px; height: 10px; margin-left: 12px; vertical-align: middle; background: repeating-linear-gradient(115deg, var(--accent-neon) 0 6px, transparent 6px 11px); }
.kos-boot pre { margin: 0; min-height: 118px; font: 12px/1.7 var(--font-mono); color: #9fdcff; white-space: pre-wrap; }
.kos-boot pre b { color: var(--accent-neon); font-weight: 600; }
.kos-boot .bar { height: 3px; margin-top: 14px; background: rgba(255,255,255,0.08); overflow: hidden; }
.kos-boot .bar i { display: block; height: 100%; width: 0; background: var(--accent-neon); box-shadow: 0 0 8px var(--accent-neon); transition: width .25s; }
.kos-boot small { display: block; margin-top: 10px; font-size: 11px; color: var(--text-faint); }
`;

function injectStyleOnce() {
  if (document.getElementById("kos-shell-style")) return;
  const style = document.createElement("style");
  style.id = "kos-shell-style";
  style.textContent = STYLE;
  document.head.appendChild(style);
}

function currentPage(): string {
  const file = location.pathname.split("/").pop() || "index.html";
  return file.replace(/\.html$/, "") || "index";
}

export function mountShell(member: Member, onSignOut: () => void) {
  injectStyleOnce();
  const me = member.actorId;
  const reLog: NavItem[] = [
    { page: "relog", href: "relog.html", icon: "💬", label: "GIF", title: "Envoyer des GIF aux autres streams" },
    { page: "room", href: "room.html", icon: "🎨", label: "Salons", title: "Dessiner, écrire, poser des GIF ensemble" },
    { page: "watch", href: "watch.html", icon: "📺", label: "Watch-party", title: "Regarder une vidéo ensemble, sur le stream de tout le salon" },
  ];
  if (me) reLog.push({ page: "player", href: `player.html?u=${encodeURIComponent(me)}`, icon: "🎮", label: "Mon player", title: "Ton module actuel et ton bouton panique" });
  const owner: NavItem[] = member.isOwner
    ? [
        { page: "master", href: "master.html", icon: "📡", label: "Tableau de bord", title: "Ton stream, les modules du groupe et les signaux" },
        { page: "forge", href: "forge.html", icon: "👥", label: "Membres", title: "Membres, modes, invitations, clé GIPHY" },
        { page: "kashiro-terminal", href: "kashiro-terminal.html", icon: "💻", label: "Terminal", title: "Terminal virus de Kashiro" },
      ]
    : [];

  const page = currentPage();
  const link = (item: NavItem) =>
    `<a href="${appUrl(item.href)}" title="${item.title}"${item.page === page ? ' aria-current="page"' : ""}><span class="i" aria-hidden="true">${item.icon}</span><span class="t">${item.label}</span></a>`;

  const nav = document.createElement("nav");
  nav.className = "kos-shell";
  nav.setAttribute("aria-label", "Navigation K-OS");
  nav.innerHTML = `
    <a class="brand" href="${appUrl("")}" title="Accueil du K-OS">K-OS<b>////</b></a>
    <div class="links">
      ${link({ page: "index", href: "", icon: "🏠", label: "Accueil", title: "Accueil et liens OBS" })}
      ${me ? link({ page: "obs", href: "obs.html", icon: "🧩", label: "Installer OBS", title: "Ajouter le K-OS dans tes scènes OBS automatiquement" }) : ""}
      <span class="sep"></span><span class="grp">Re:log</span>
      ${reLog.map(link).join("")}
      ${owner.length ? `<span class="sep"></span><span class="grp">Gestion</span>${owner.map(link).join("")}` : ""}
    </div>
    <div class="me">
      <span class="dot"></span>
      <span><span class="name"></span> <span class="role"></span></span>
      <button title="Se déconnecter"><span aria-hidden="true">⏻</span> <span class="out-t">Déconnexion</span></button>
    </div>`;
  const role = member.isOwner ? "propriétaire" : "membre";
  nav.querySelector(".role")!.textContent = `· ${role}`;
  nav.querySelector<HTMLElement>(".me")!.title = member.email;
  nav.querySelector("button")!.addEventListener("click", onSignOut);
  document.body.prepend(nav);
  mountStatusBar(member);
  bootSequence(member);

  const name = nav.querySelector<HTMLElement>(".name")!;
  name.textContent = me ?? member.email;
  if (me) {
    watchActors((actors) => {
      const a = actors[me];
      if (!a) return;
      name.textContent = a.name;
      nav.querySelector<HTMLElement>(".me")!.style.setProperty("--c", a.color || "#00d4ff");
    });
  }
  // Lien actif visible même dans une barre qui défile (dock étroit).
  nav.querySelector<HTMLElement>('[aria-current="page"]')?.scrollIntoView({ inline: "center", block: "nearest" });
}

/** Barre d'état en bas de chaque page : connexion au K-OS, membre, heure. */
function mountStatusBar(member: Member) {
  const bar = document.createElement("footer");
  bar.className = "kos-status";
  bar.setAttribute("aria-label", "État du K-OS");
  bar.innerHTML = `<span class="pw" aria-hidden="true"></span><span class="net">● connexion…</span><span class="who"></span><span class="ver">K-OS v2</span><span class="clock push"></span>`;
  bar.querySelector(".who")!.textContent = member.actorId ? `membre · ${member.actorId}` : member.email;
  document.body.appendChild(bar);
  const net = bar.querySelector<HTMLElement>(".net")!;
  onValue(ref(db, ".info/connected"), (snap) => {
    const ok = snap.val() === true;
    net.className = `net ${ok ? "ok" : "bad"}`;
    net.textContent = ok ? "● signal stable" : "● signal perdu, reconnexion…";
  });
  const clock = bar.querySelector<HTMLElement>(".clock")!;
  const tick = () => (clock.textContent = new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
  tick();
  setInterval(tick, 1000);
}

/** Démarrage du K-OS : une fois par session (onglet), passable d'un clic, absent si animations réduites. */
function bootSequence(member: Member) {
  let seen = false;
  try {
    seen = sessionStorage.getItem("kos.booted") === "1";
    sessionStorage.setItem("kos.booted", "1");
  } catch {
    seen = true;
  }
  if (seen || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const who = (member.actorId ?? member.email).toUpperCase().replace(/[<>&"]/g, "");
  const lines = [
    "> K-OS v2 · noyau chargé",
    `> identification ........ <b>${who}</b>`,
    "> synchronisation registre ... OK",
    "> canaux Re:log ouverts",
    "> <b>ACCÈS AUTORISÉ</b> ▌",
  ];
  const el = document.createElement("div");
  el.className = "kos-boot";
  el.setAttribute("role", "status");
  el.innerHTML = `<div class="box"><span class="tab">K - O S</span><pre></pre><div class="bar"><i></i></div><small>Clique pour passer</small></div>`;
  document.body.appendChild(el);
  const pre = el.querySelector("pre")!;
  const bar = el.querySelector<HTMLElement>(".bar i")!;
  let i = 0;
  let timer: ReturnType<typeof setTimeout>;
  const close = () => {
    clearTimeout(timer);
    el.classList.add("done");
    setTimeout(() => el.remove(), 400);
  };
  const step = () => {
    i++;
    pre.innerHTML = lines.slice(0, i).join("\n");
    bar.style.width = `${(i / lines.length) * 100}%`;
    timer = i < lines.length ? setTimeout(step, 230) : setTimeout(close, 550);
  };
  el.addEventListener("click", close);
  step();
}
