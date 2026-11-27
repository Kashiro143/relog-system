import "../theme.css";
import { onAuthStateChanged } from "firebase/auth";
import { auth, authErrorMessage, resolveMember, safeNext, signInWithGoogle, signOut } from "../auth";

const view = document.getElementById("view")!;
const sub = document.getElementById("sub")!;
const next = safeNext(new URLSearchParams(window.location.search).get("next"));

function message(kind: "ok" | "err", text: string) {
  view.querySelector(".msg")?.remove();
  const el = document.createElement("p");
  el.className = `msg ${kind}`;
  el.textContent = text;
  view.appendChild(el);
}

function showSignInButton() {
  sub.textContent = "Connexion au collectif Re:log";
  view.innerHTML = `<button id="google">Se connecter avec Google</button>`;
  const btn = view.querySelector<HTMLButtonElement>("#google")!;
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    try {
      await signInWithGoogle();
      const member = await resolveMember(auth.currentUser!);
      if (!member.actorId && !member.isOwner && !member.ownerUnclaimed) {
        await signOut();
        message("err", `${member.email} n'est pas invitée. Demande à Kashiro de l'ajouter dans la page Membres.`);
        return;
      }
      window.location.replace(next);
    } catch (err) {
      message("err", authErrorMessage(err));
    } finally {
      btn.disabled = false;
    }
  });
}

function showSignedIn(email: string) {
  sub.textContent = "Déjà connecté";
  view.innerHTML = `
    <p style="font-size:0.9rem;">Connecté avec <strong></strong>.</p>
    <div class="actions">
      <a class="btn" id="continue">Continuer</a>
      <button id="out">Se déconnecter</button>
    </div>`;
  view.querySelector("strong")!.textContent = email;
  view.querySelector<HTMLAnchorElement>("#continue")!.href = next;
  view.querySelector("#out")!.addEventListener("click", async () => {
    await signOut();
    showSignInButton();
  });
}

const stop = onAuthStateChanged(auth, (user) => {
  stop();
  if (user?.email) showSignedIn(user.email);
  else showSignInButton();
});
