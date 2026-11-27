# Kashiro — Starting soon

Outil autonome, indépendant du K-OS : pas d'internet, pas de compte, pas d'installation.

| Fichier | Rôle |
|---|---|
| `display.html` | L'écran affiché en stream. Il tourne tout seul en boucle. |
| `controller.html` | Le panneau : aperçu, style, message en direct, bibliothèque de messages. |

## Bibliothèque de messages

Les messages sont rangés par **groupes** : Général, un jeu, un invité, un événement…
Chaque groupe et chaque message a un interrupteur : **seuls les messages activés tournent
dans la boucle**. Pour un stream League avec Saitho, activez Général + League + Saitho.

- `▶` affiche un message tout de suite sans toucher à la boucle.
- Cliquez sur un message pour le modifier (Ctrl + Entrée pour enregistrer, Échap pour annuler).
- `✎` sur un groupe : le renommer, changer son type, le déplacer ou le supprimer.
- **Sauvegarde** (en bas) : copiez le texte pour garder vos messages, collez-le pour les restaurer.
  Les messages sont stockés par OBS : vider le cache d'OBS les efface.

## Adresses en ligne

Le même outil est publié sur GitHub Pages, à utiliser à la place des fichiers locaux :

- Écran : `https://kashiro143.github.io/relog-system/starting-soon/display.html`
- Panneau : `https://kashiro143.github.io/relog-system/starting-soon/controller.html`

Utilisez soit les deux adresses en ligne, soit les deux fichiers locaux : l'écran et le
panneau ne se parlent que s'ils viennent du même endroit.

## Installation dans OBS (fichiers locaux)

1. **L'écran** : Sources > + > *Navigateur*, cochez **Fichier local**, choisissez `display.html`.
   Largeur 1920, hauteur 1080.
2. **Le panneau** : menu *Docks* > *Docks de navigateur personnalisés*, nom `Starting soon`,
   URL : `file:///E:/Dev/Twitch/starting-soon/controller.html`.

Le panneau doit être ouvert **dans OBS** (dock) : c'est ce qui lui permet de partager
ses réglages avec l'écran. Ouvert dans Chrome, il ne pilotera pas OBS.

Sans panneau, l'écran joue les messages par défaut écrits en haut de `display.html`.

## Réglages par l'adresse (facultatif)

Dans la source OBS, décochez *Fichier local* et utilisez l'URL du fichier avec des paramètres :
`file:///E:/Dev/Twitch/starting-soon/display.html?skin=techwear&hold=8&bg=%23000`

- `skin` : `classic` (terminal cyan) ou `techwear` (HUD blanc)
- `hold` : secondes d'affichage d'un message une fois tapé
- `bg` : couleur de fond (`%23000` = noir), transparent par défaut

Ces paramètres passent avant les réglages du panneau.
