import "../theme.css";
import { ref, update } from "firebase/database";
import { db } from "../firebase";
import { requireMember, blockPage, signOut } from "../auth";
import { watchActors } from "../registry";
import { THEMES, onPrefs, savePrefs, type Prefs } from "../prefs";

const member = await requireMember();
const me = member.actorId;
if (!me) {
  blockPage("Compte non relié", "Ton adresse n'est liée à aucun membre Re:log : demande une invitation à Kashiro.");
  throw new Error("no actor");
}

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const PALETTE = ["#00d4ff", "#3dffb0", "#ffd34d", "#ff9f1c", "#ff4757", "#ff5fd2", "#a46bff", "#ffffff"];

function feedback(id: string, kind: "ok" | "err", text: string) {
  const el = $(id);
  el.className = `feedback ${kind}`;
  el.textContent = text;
  setTimeout(() => {
    if (el.textContent === text) el.textContent = "";
  }, 3000);
}

// ---------- Compte ----------

$("email").textContent = member.email;
$("actor").textContent = me;
$("role").textContent = member.isOwner ? "Propriétaire du K-OS" : "Membre Re:log";
$("logout").addEventListener("click", () => signOut());

// ---------- Profil ----------

let color = "#00d4ff";
let loaded = false;

function renderIdentity(name: string) {
  $("id-name").textContent = name || me!;
  $("id-sub").textContent = member.isOwner ? "Propriétaire · Re:log" : "Membre · Re:log";
  const avatar = $("avatar");
  avatar.textContent = (name || me!).slice(0, 1).toUpperCase();
  avatar.style.setProperty("--c", color);
}

function renderSwatches() {
  const box = $("swatches");
  box.replaceChildren();
  for (const c of PALETTE) {
    const b = document.createElement("button");
    b.type = "button";
    b.style.setProperty("--c", c);
    b.title = c;
    b.setAttribute("aria-label", `Couleur ${c}`);
    b.className = c.toLowerCase() === color.toLowerCase() ? "on" : "";
    b.addEventListener("click", () => {
      color = c;
      renderSwatches();
      renderIdentity($<HTMLInputElement>("name").value.trim());
    });
    box.appendChild(b);
  }
  const custom = document.createElement("input");
  custom.type = "color";
  custom.value = /^#[0-9a-f]{6}$/i.test(color) ? color : "#00d4ff";
  custom.title = "Autre couleur";
  custom.setAttribute("aria-label", "Choisir une autre couleur");
  custom.addEventListener("input", () => {
    color = custom.value;
    renderIdentity($<HTMLInputElement>("name").value.trim());
    box.querySelectorAll("button").forEach((b) => b.classList.remove("on"));
  });
  box.appendChild(custom);
}

watchActors((actors) => {
  const a = actors[me];
  if (!a || loaded) return; // on ne réécrit pas ce que l'utilisateur est en train de modifier
  loaded = true;
  color = /^#[0-9a-f]{6}$/i.test(a.color || "") ? a.color : "#00d4ff";
  $<HTMLInputElement>("name").value = a.name || me;
  renderSwatches();
  renderIdentity(a.name || me);
});
$("name").addEventListener("input", () => renderIdentity($<HTMLInputElement>("name").value.trim()));

$("save-profile").addEventListener("click", async () => {
  const name = $<HTMLInputElement>("name").value.trim();
  if (!name) return feedback("profile-fb", "err", "Donne un nom à afficher.");
  try {
    await update(ref(db, `registry/users/${me}`), { name: name.slice(0, 24), color: color.toLowerCase() });
    feedback("profile-fb", "ok", "Profil mis à jour sur tout le réseau ✓");
  } catch {
    feedback("profile-fb", "err", "Transmission refusée : profil non enregistré.");
  }
});

// ---------- Style du K-OS ----------

function renderThemes(p: Prefs) {
  const box = $("themes");
  box.replaceChildren();
  for (const t of THEMES) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `theme${p.theme === t.id ? " on" : ""}`;
    b.setAttribute("aria-pressed", String(p.theme === t.id));
    b.innerHTML = `<span class="mini ${t.id}" aria-hidden="true"><i class="p"></i><i class="t"></i><i class="s"></i></span><span><b></b><small></small></span>`;
    b.querySelector("b")!.textContent = t.label;
    if (t.id === "cockpit") b.querySelector("b")!.insertAdjacentHTML("beforeend", `<span class="tag">défaut</span>`);
    b.querySelector("small")!.textContent = t.hint;
    b.addEventListener("click", () => {
      savePrefs(me!, { theme: t.id })
        .then(() => feedback("prefs-fb", "ok", `Style « ${t.label} » activé ✓`))
        .catch(() => feedback("prefs-fb", "err", "Préférence non enregistrée."));
    });
    box.appendChild(b);
  }
}

// ---------- Expérience ----------

function renderOptions(p: Prefs) {
  document.querySelectorAll<HTMLElement>(".seg[data-pref]").forEach((seg) => {
    const key = seg.dataset.pref as keyof Prefs;
    seg.querySelectorAll<HTMLButtonElement>("button").forEach((b) => {
      const on = String(p[key]) === b.dataset.v;
      b.classList.toggle("on", on);
      b.setAttribute("aria-pressed", String(on));
    });
  });
}
document.querySelectorAll<HTMLElement>(".seg[data-pref]").forEach((seg) => {
  seg.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button");
    if (!b) return;
    const key = seg.dataset.pref as keyof Prefs;
    const raw = b.dataset.v!;
    const value = raw === "true" ? true : raw === "false" ? false : raw;
    savePrefs(me!, { [key]: value } as Partial<Prefs>)
      .then(() => feedback("prefs-fb", "ok", "Préférence enregistrée ✓"))
      .catch(() => feedback("prefs-fb", "err", "Préférence non enregistrée."));
  });
});

onPrefs((p) => {
  renderThemes(p);
  renderOptions(p);
});
