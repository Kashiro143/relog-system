import { ref, onValue, set, update, get } from "firebase/database";
import type { Unsubscribe } from "firebase/database";
import { db } from "../../firebase";

// Statuts : 0 = en vie, 1 = KO 15 min, 2 = KO 30 min, 3 = mort perma.
export const STATUS_LABELS = ["EN VIE", "15 MIN", "30 MIN", "PERMA"];

export interface Slot {
  pokemonId: number;
  pokemonName: string;
  nickname?: string;
  status: 0 | 1 | 2 | 3;
  history: 0 | 1;
  timestamp: number | null;
}

export type Team = Record<number, Slot | undefined>;
export type Order = Record<number, number>;

export interface Layout {
  x: number;
  y: number;
  s: number;
  colorNeon: string;
  colorText: string;
}

export const DEFAULT_LAYOUT: Layout = { x: 20, y: 20, s: 1, colorNeon: "#00d4ff", colorText: "#ffffff" };

function base(actorId: string) {
  return `live_data/${actorId}/pokemmo`;
}

export function watchTeam(actorId: string, callback: (team: Team, order: Order) => void): Unsubscribe {
  return onValue(ref(db, base(actorId)), (snap) => {
    const data = snap.val() ?? {};
    callback(data.team ?? {}, data.order ?? {});
  });
}

export function watchLayout(actorId: string, callback: (layout: Layout) => void): Unsubscribe {
  return onValue(ref(db, `${base(actorId)}/layout`), (snap) => callback({ ...DEFAULT_LAYOUT, ...snap.val() }));
}

export function setOrder(actorId: string, order: Order) {
  return set(ref(db, `${base(actorId)}/order`), order);
}

export function updateLayout(actorId: string, patch: Partial<Layout>) {
  return update(ref(db, `${base(actorId)}/layout`), patch);
}

export function updateSlotFields(actorId: string, slotId: number, patch: Partial<Slot>) {
  return update(ref(db, `${base(actorId)}/team/${slotId}`), patch);
}

export async function getSlot(actorId: string, slotId: number): Promise<Slot | undefined> {
  const snap = await get(ref(db, `${base(actorId)}/team/${slotId}`));
  return snap.val() ?? undefined;
}

/** Fait progresser un slot dans le cycle EN VIE -> 15/30 MIN -> PERMA, avec l'historique de blessure. */
export async function cycleSlotStatus(actorId: string, slotId: number) {
  const slot = (await getSlot(actorId, slotId)) ?? { history: 0, status: 0 };
  const current = slot.status ?? 0;
  let next: Slot["status"] = 0;
  let history: Slot["history"] = slot.history ?? 0;

  if (current === 0) {
    next = history === 1 ? 2 : 1;
  } else if (current === 1) {
    next = 2;
    history = 1;
  } else if (current === 2) {
    next = 3;
    history = 1;
  } else {
    next = 0;
    history = 0;
  }

  await updateSlotFields(actorId, slotId, { status: next, timestamp: Date.now(), history });
}

/** Ressuscite automatiquement les Pokémon dont le KO temporaire est écoulé (à appeler chaque seconde). */
export async function checkAutoRevive(actorId: string, team: Team) {
  for (const [id, slot] of Object.entries(team)) {
    if (!slot?.timestamp || (slot.status !== 1 && slot.status !== 2)) continue;
    const duration = slot.status === 1 ? 15 * 60 * 1000 : 30 * 60 * 1000;
    if (Date.now() - slot.timestamp >= duration) {
      await updateSlotFields(actorId, Number(id), { status: 0, timestamp: null, history: 1 });
    }
  }
}

export function getRemainingTime(slot: Slot | undefined): string {
  if (!slot?.timestamp || (slot.status !== 1 && slot.status !== 2)) return "";
  const duration = slot.status === 1 ? 15 * 60 * 1000 : 30 * 60 * 1000;
  const remaining = duration - (Date.now() - slot.timestamp);
  if (remaining <= 0) return "PRÊT !";
  const mins = Math.floor(remaining / 60000);
  const secs = Math.floor((remaining % 60000) / 1000);
  return `${mins}:${secs < 10 ? "0" : ""}${secs}`;
}

export function healAll(actorId: string, team: Team) {
  const updates: Record<string, unknown> = {};
  Object.keys(team).forEach((id) => {
    updates[`${base(actorId)}/team/${id}/status`] = 0;
    updates[`${base(actorId)}/team/${id}/timestamp`] = null;
  });
  return update(ref(db), updates);
}
