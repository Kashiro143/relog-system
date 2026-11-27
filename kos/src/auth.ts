import {
  getAuth,
  onAuthStateChanged,
  signOut as fbSignOut,
  signInWithPopup,
  GoogleAuthProvider,
  type User,
} from "firebase/auth";
import { ref, get, set, remove, onValue, type Unsubscribe } from "firebase/database";
import { app, db } from "./firebase";
import { appUrl } from "./appUrl";

// Connexion par compte Google : l'adresse vérifiée est liée au membre.
// Kashiro invite une adresse depuis la Forge : auth/invites/{emailKey} = { actorId, email }.
// Le propriétaire du K-OS est désigné par auth/owner = emailKey (revendiqué une seule fois).

export const auth = getAuth(app);

export interface Invite {
  actorId: string;
  email: string;
  invitedAt: number;
}

export interface Member {
  user: User;
  email: string;
  /** Membre Re:log lié à cette adresse (null si non invité). */
  actorId: string | null;
  isOwner: boolean;
  /** Aucun propriétaire n'a encore été revendiqué. */
  ownerUnclaimed: boolean;
}

/** Les clés Realtime Database ne peuvent pas contenir de "." */
export function emailKey(email: string): string {
  return email.trim().toLowerCase().replace(/\./g, ",");
}

function currentUser(): Promise<User | null> {
  return new Promise((resolve) => {
    const stop = onAuthStateChanged(auth, (user) => {
      stop();
      resolve(user);
    });
  });
}

export async function resolveMember(user: User): Promise<Member> {
  const email = user.email ?? "";
  const key = emailKey(email);
  const [invite, owner] = await Promise.all([get(ref(db, `auth/invites/${key}`)), get(ref(db, "auth/owner"))]);
  return {
    user,
    email,
    actorId: (invite.val() as Invite | null)?.actorId ?? null,
    isOwner: owner.val() === key,
    ownerUnclaimed: !owner.exists(),
  };
}

// --- Connexion ---

/** N'accepte qu'un chemin interne au site, pour éviter toute redirection vers l'extérieur. */
export function safeNext(next: string | null): string {
  const base = import.meta.env.BASE_URL;
  if (!next) return base;
  try {
    const target = new URL(next, window.location.origin);
    if (target.origin === window.location.origin && target.pathname.startsWith(base)) {
      return target.pathname + target.search;
    }
  } catch {
    /* adresse illisible : retour à l'accueil */
  }
  return base;
}

/**
 * Fenêtre Google. Pas de redirection : sur GitHub Pages, le domaine d'auth
 * (firebaseapp.com) diffère du site et les navigateurs bloquent ce retour.
 */
export async function signInWithGoogle() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  await signInWithPopup(auth, provider);
}

export function signOut() {
  return fbSignOut(auth);
}

export function authErrorMessage(err: unknown): string {
  const code = (err as { code?: string })?.code ?? "";
  const messages: Record<string, string> = {
    "auth/operation-not-allowed": "La connexion Google n'est pas activée dans la console Firebase.",
    "auth/too-many-requests": "Trop de tentatives, attends quelques minutes.",
    "auth/network-request-failed": "Pas de connexion réseau.",
    "auth/unauthorized-domain": "Ce domaine n'est pas autorisé dans Firebase Authentication (Settings > Authorized domains).",
    "auth/popup-blocked": "Le navigateur a bloqué la fenêtre Google. Autorise les pop-ups pour ce site.",
    "auth/popup-closed-by-user": "Fenêtre Google fermée avant la fin.",
    "auth/cancelled-popup-request": "Fenêtre Google fermée avant la fin.",
  };
  return messages[code] ?? `Erreur inattendue (${code || String(err)}).`;
}

// --- Garde des pages ---

function loginUrl(): string {
  const next = window.location.pathname + window.location.search;
  return `${appUrl("login.html")}?next=${encodeURIComponent(next)}`;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** Écran plein qui bloque la page, avec un bouton de déconnexion. */
export function blockPage(title: string, message: string, withSignOut = true) {
  document.body.innerHTML = `
    <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:16px;">
      <div class="panel" style="max-width:420px;width:100%;text-align:center;">
        <h3>${escapeHtml(title)}</h3>
        <p style="color:var(--text-dim);font-size:0.9rem;">${escapeHtml(message)}</p>
        <div style="display:flex;gap:8px;justify-content:center;margin-top:16px;">
          <a class="btn" href="${appUrl("")}">Accueil</a>
          ${withSignOut ? '<button id="kos-block-signout">Se déconnecter</button>' : ""}
        </div>
      </div>
    </div>`;
  document.getElementById("kos-block-signout")?.addEventListener("click", async () => {
    await signOut();
    window.location.href = loginUrl();
  });
}

/**
 * À appeler en tête des pages protégées. Redirige vers login.html si personne
 * n'est connecté ; bloque la page si l'adresse n'a pas le droit d'y être.
 * ownerOnly laisse passer tant qu'aucun propriétaire n'a été revendiqué
 * (premier passage de Kashiro dans la Forge).
 */
export async function requireMember(opts: { ownerOnly?: boolean } = {}): Promise<Member> {
  const user = await currentUser();
  if (!user) {
    window.location.replace(loginUrl());
    return new Promise<Member>(() => {});
  }
  const member = await resolveMember(user);
  if (opts.ownerOnly && !member.isOwner && !member.ownerUnclaimed) {
    blockPage("Accès réservé", `Cette page est réservée au propriétaire du K-OS. Tu es connecté avec ${member.email}.`);
    return new Promise<Member>(() => {});
  }
  if (!opts.ownerOnly && !member.actorId && !member.isOwner) {
    blockPage("Adresse non invitée", `${member.email} n'est liée à aucun membre Re:log. Demande une invitation à Kashiro.`);
    return new Promise<Member>(() => {});
  }
  mountAccountBadge(member);
  return member;
}

/** Petit rappel discret du compte connecté, avec déconnexion. */
function mountAccountBadge(member: Member) {
  const badge = document.createElement("div");
  badge.id = "kos-account";
  badge.style.cssText =
    "position:fixed;right:12px;top:12px;z-index:200;display:flex;gap:8px;align-items:center;" +
    "background:var(--panel-bg);border:1px solid var(--border);border-radius:6px;padding:4px 6px 4px 10px;" +
    "font-size:11px;color:var(--text-dim);max-width:calc(100vw - 24px);";
  const label = member.isOwner ? "propriétaire" : member.actorId ?? "";
  badge.innerHTML = `<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(member.email)} · ${escapeHtml(label)}</span>`;
  const out = document.createElement("button");
  out.textContent = "Déconnexion";
  out.style.cssText = "padding:3px 8px;font-size:11px;";
  out.addEventListener("click", async () => {
    await signOut();
    window.location.href = loginUrl();
  });
  badge.appendChild(out);
  document.body.appendChild(badge);
}

// --- Gestion des invitations (Forge) ---

export function watchInvites(callback: (invites: Record<string, Invite>) => void): Unsubscribe {
  return onValue(ref(db, "auth/invites"), (snap) => callback(snap.val() ?? {}));
}

export function watchOwner(callback: (ownerKey: string | null) => void): Unsubscribe {
  return onValue(ref(db, "auth/owner"), (snap) => callback(snap.val()));
}

export function createInvite(email: string, actorId: string) {
  const invite: Invite = { actorId, email: email.trim().toLowerCase(), invitedAt: Date.now() };
  return set(ref(db, `auth/invites/${emailKey(email)}`), invite);
}

export function deleteInvite(key: string) {
  return remove(ref(db, `auth/invites/${key}`));
}

export function claimOwnership(email: string) {
  return set(ref(db, "auth/owner"), emailKey(email));
}
