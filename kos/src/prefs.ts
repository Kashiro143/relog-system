import { ref, onValue, update, type Unsubscribe } from "firebase/database";
import { db } from "./firebase";

// Préférences du compte d'un membre : relog/prefs/{membre} (lisibles et
// modifiables par lui seul). Une copie locale permet d'appliquer le style dès
// l'ouverture de la page, avant même la connexion à Firebase.

export type KosTheme = "cockpit" | "terminal" | "holo";
export type Motion = "full" | "reduced";

export interface Prefs {
  theme: KosTheme;
  /** Bips d'interface. */
  sound: boolean;
  /** Séquence de démarrage à la première page de chaque session. */
  boot: boolean;
  /** "reduced" : pas d'animations décoratives (balayage, transitions, démarrage). */
  motion: Motion;
}

export const DEFAULT_PREFS: Prefs = { theme: "cockpit", sound: false, boot: true, motion: "full" };

export const THEMES: { id: KosTheme; label: string; hint: string }[] = [
  { id: "cockpit", label: "Cockpit HUD", hint: "Bleu électrique et néon cyan, comme les overlays du stream." },
  { id: "terminal", label: "Terminal noyau", hint: "Le K-OS infecté par le virus : phosphore vert, tout en terminal." },
  { id: "holo", label: "Holo verre", hint: "Panneaux de verre translucides, calme et haut de gamme." },
];

const CACHE_KEY = "kos.prefs";
const isTheme = (v: unknown): v is KosTheme => THEMES.some((t) => t.id === v);

function clean(raw: unknown): Prefs {
  const r = (raw ?? {}) as Partial<Prefs>;
  return {
    theme: isTheme(r.theme) ? r.theme : DEFAULT_PREFS.theme,
    sound: typeof r.sound === "boolean" ? r.sound : DEFAULT_PREFS.sound,
    boot: typeof r.boot === "boolean" ? r.boot : DEFAULT_PREFS.boot,
    motion: r.motion === "reduced" ? "reduced" : "full",
  };
}

let current: Prefs = DEFAULT_PREFS;
const listeners = new Set<(p: Prefs) => void>();

export const getPrefs = () => current;

/** Applique les préférences à la page (style, animations) et prévient les abonnés. */
export function applyPrefs(p: Prefs) {
  current = p;
  const root = document.documentElement;
  root.dataset.kosTheme = p.theme;
  root.dataset.motion = p.motion;
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(p));
  } catch {}
  listeners.forEach((fn) => fn(p));
}

export function onPrefs(fn: (p: Prefs) => void): () => void {
  listeners.add(fn);
  fn(current);
  return () => listeners.delete(fn);
}

/** Suit les préférences enregistrées sur le compte. */
export function watchPrefs(actorId: string): Unsubscribe {
  return onValue(ref(db, `relog/prefs/${actorId}`), (snap) => applyPrefs(clean(snap.val())));
}

export function savePrefs(actorId: string, patch: Partial<Prefs>) {
  applyPrefs({ ...current, ...patch }); // effet immédiat, sans attendre le serveur
  return update(ref(db, `relog/prefs/${actorId}`), patch);
}

// Au chargement : la dernière copie locale, tout de suite.
try {
  applyPrefs(clean(JSON.parse(localStorage.getItem(CACHE_KEY) || "null")));
} catch {
  applyPrefs(DEFAULT_PREFS);
}
