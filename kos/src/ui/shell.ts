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
.kos-shell { position: sticky; top: 0; z-index: 50; display: flex; align-items: center; gap: 6px; padding: 0 12px; height: var(--shell-h); background: color-mix(in srgb, var(--panel-bg) 92%, transparent); backdrop-filter: blur(8px); border-bottom: 1px solid var(--border); }
.kos-shell .brand { font-family: var(--font-mono); font-weight: 700; letter-spacing: 3px; color: var(--accent-neon); text-decoration: none; padding: 6px 8px 6px 0; margin-right: 4px; white-space: nowrap; }
.kos-shell .links { display: flex; align-items: center; gap: 2px; flex: 1; min-width: 0; overflow-x: auto; scrollbar-width: none; }
.kos-shell .links::-webkit-scrollbar { display: none; }
.kos-shell .links a { display: inline-flex; align-items: center; gap: 6px; padding: 7px 10px; border-radius: var(--radius); color: var(--text-dim); text-decoration: none; font-size: 13px; font-weight: 600; white-space: nowrap; }
.kos-shell .links a:hover { color: var(--text-main); background: rgba(255,255,255,0.05); }
.kos-shell .links a[aria-current="page"] { color: var(--accent-neon); background: var(--accent-low); }
.kos-shell .links .sep { width: 1px; height: 20px; background: var(--border); margin: 0 6px; flex: none; }
.kos-shell .links .grp { font-size: 10px; letter-spacing: 2px; text-transform: uppercase; color: var(--text-faint); padding: 0 4px 0 2px; white-space: nowrap; }
.kos-shell .me { display: flex; align-items: center; gap: 8px; flex: none; font-size: 13px; }
.kos-shell .me .dot { width: 10px; height: 10px; border-radius: 50%; background: var(--c, var(--accent-neon)); box-shadow: 0 0 8px var(--c, var(--accent-neon)); }
.kos-shell .me .name { font-weight: 700; max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.kos-shell .me .role { font-size: 11px; color: var(--text-dim); }
.kos-shell .me button { padding: 6px 10px; font-size: 12px; }
@media (max-width: 1240px) { .kos-shell .links .grp, .kos-shell .me .role { display: none; } }
@media (max-width: 1080px) {
  .kos-shell .links a .t { display: none; }
  .kos-shell .links a { padding: 7px 9px; font-size: 16px; }
}
@media (max-width: 520px) {
  .kos-shell .me .name, .kos-shell .me .out-t { display: none; }
  .kos-shell .brand { letter-spacing: 1px; }
}
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
    { page: "room", href: "room.html", icon: "🎨", label: "Salons", title: "Dessiner, écrire, poser des GIF, watch-party" },
  ];
  if (me) reLog.push({ page: "player", href: `player.html?u=${encodeURIComponent(me)}`, icon: "🎮", label: "Mon player", title: "Ton module actuel et ton bouton panique" });
  const owner: NavItem[] = member.isOwner
    ? [
        { page: "master", href: "master.html", icon: "📡", label: "Groupe", title: "Piloter les overlays du groupe" },
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
    <a class="brand" href="${appUrl("")}" title="Accueil du K-OS">K-OS</a>
    <div class="links">
      ${link({ page: "index", href: "", icon: "🏠", label: "Accueil", title: "Accueil et liens OBS" })}
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
