// ===================== CONFIGURATION DU CHATBOX =====================
// Modifie ces valeurs directement ici, ou utilise config-panel.html
// pour une interface visuelle avec aperçu en direct.
// N'oublie pas de garder ce fichier dans le même dossier que le chatbox.
// =======================================================================

window.CHATBOX_CONFIG = {
  channel: "kashiro143",        // ton pseudo Twitch (sans le #)

  limitEnabled: true,           // true = limite le nombre de messages affichés à l'écran
  limitCount: 50,                // nombre max de messages affichés simultanément

  usernameFontSize: 16,          // taille du pseudo, en pt
  messageFontSize: 16,           // taille du message, en pt
  boxSpacing: 15,                // espace entre deux messages, en px

  accentColor: "#17E8FF",        // couleur du fond du pseudo + bordures + triangle
  textColor: "#140E63",          // couleur du texte (pseudo + message)

  defaultFont: "Tomorrow",       // police par défaut (voir la liste dans roleProfiles ci-dessous)
  boxRadius: 0,                  // arrondi des coins des bulles, en px (0 = coins carrés comme actuellement)
  gradientColor1: "#E8F4FF",     // couleur de départ du dégradé de fond des bulles
  gradientColor2: "#A8D8FF",     // couleur de fin du dégradé de fond des bulles
  showSparkle: true,             // affiche la petite décoration étincelle sur chaque bulle

  position: "bottom-left",       // "bottom-left" | "bottom-right" | "top-left" | "top-right"

  showBadges: true,              // afficher les badges Twitch (mod, sub, vip, etc.)
  showBTTV: true,                 // afficher les émotes BetterTTV
  showFFZ: true,                  // afficher les émotes FrankerFaceZ
  show7TV: true,                   // afficher les émotes 7TV

  // ----- Personnalisation avancée -----
  animationStyle: "slide",        // "slide" | "fade" | "pop" | "typewriter"

  mentionHighlight: true,         // effet lumineux sur les messages qui te mentionnent (@tonPseudo)

  floatingReactions: true,        // fait flotter une émote au-dessus du chat pour les messages 100% émotes

  newUserTag: true,               // affiche un tag pour le 1er message d'un viewer (par session)
  newUserTagText: "Nouveau",      // texte affiché dans ce tag
  newUserTagDuration: 4,          // durée d'affichage du tag, en secondes

  autoHide: "never",              // "never" | "30" | "60" | "120" — masque le chat après X secondes d'inactivité

  // ----- Profils par rôle -----
  // Chaque rôle est un profil indépendant : couleur ET police propres.
  // Priorité si plusieurs badges : streamer > modérateur > VIP > abonné > style par défaut (accentColor / police du haut).
  // Polices disponibles : "Tomorrow", "Poppins", "Bebas Neue", "Share Tech Mono", "Press Start 2P", "Comfortaa"
  // "textColor" fixe la couleur du pseudo pour ce rôle (au lieu de la couleur aléatoire assignée par Twitch),
  // pour garantir un bon contraste avec la couleur d'accent du rôle.
  roleProfiles: {
    broadcaster: { enabled: true, color: "#FF6EC7", textColor: "#3D0066", font: "Tomorrow" },
    moderator:   { enabled: true, color: "#00C2FF", textColor: "#052940", font: "Tomorrow" },
    vip:         { enabled: true, color: "#FFD166", textColor: "#5C2E00", font: "Tomorrow" },
    subscriber:  { enabled: true, color: "#6BFFB0", textColor: "#023B1D", font: "Tomorrow" }
  }
};
