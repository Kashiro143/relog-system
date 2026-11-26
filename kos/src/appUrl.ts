/**
 * Adresse absolue d'une page de l'app, valable à la racine (dev) comme dans le
 * sous-dossier d'un site GitHub Pages (`pseudo.github.io/repo/`). Les chemins
 * stockés dans Firebase ("/modules/...") sont relatifs à l'app, pas au domaine.
 */
export function appUrl(path: string): string {
  if (/^https?:\/\//.test(path)) return path;
  return new URL(import.meta.env.BASE_URL + path.replace(/^\/+/, ""), window.location.origin).href;
}
