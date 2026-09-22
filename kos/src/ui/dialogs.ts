// OBS Browser Source (et le navigateur de prévisualisation Claude) n'affichent
// pas fiablement les dialogues natifs alert()/confirm() : équivalents inline.

export function flashError(anchor: HTMLElement, message: string) {
  const existing = anchor.querySelector<HTMLElement>(".field-error");
  if (existing) existing.remove();
  const el = document.createElement("div");
  el.className = "field-error";
  el.textContent = message;
  el.style.cssText = "color:var(--status-offline); font-size:0.75rem; margin-top:4px;";
  anchor.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

export function armConfirmDelete(btn: HTMLButtonElement, onConfirm: () => void, label = "×") {
  let armed = false;
  let resetTimer: ReturnType<typeof setTimeout>;
  btn.addEventListener("click", () => {
    if (!armed) {
      armed = true;
      btn.textContent = "Confirmer ?";
      btn.style.background = "#fff";
      resetTimer = setTimeout(() => {
        armed = false;
        btn.textContent = label;
        btn.style.background = "";
      }, 3000);
      return;
    }
    clearTimeout(resetTimer);
    onConfirm();
  });
}
