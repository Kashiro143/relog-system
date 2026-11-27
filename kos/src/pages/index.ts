import { onAuthStateChanged } from "firebase/auth";
import { auth, resolveMember, signOut } from "../auth";
import { appUrl } from "../appUrl";

const box = document.getElementById("account")!;

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    box.innerHTML = `<span>Non connecté</span><div class="links"><a class="btn" href="${appUrl("login.html")}">Se connecter</a></div>`;
    return;
  }
  const member = await resolveMember(user);
  const who = member.isOwner ? "propriétaire" : member.actorId ?? "adresse non invitée";
  box.innerHTML = `<span></span><div class="links"></div>`;
  box.querySelector("span")!.textContent = `${member.email} · ${who}`;
  const links = box.querySelector(".links")!;
  if (member.actorId) {
    const a = document.createElement("a");
    a.className = "btn";
    a.href = `${appUrl("player.html")}?u=${encodeURIComponent(member.actorId)}`;
    a.textContent = "Mon player";
    links.appendChild(a);
  }
  const out = document.createElement("button");
  out.textContent = "Déconnexion";
  out.addEventListener("click", () => signOut());
  links.appendChild(out);
});
