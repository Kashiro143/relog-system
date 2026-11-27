import { ref, onValue } from "firebase/database";
import { db } from "../firebase";

// Heure du serveur Firebase : les PC des membres n'ont pas tous la même horloge,
// or les éléments éphémères (traits, textes, GIF des salons) disparaissent à
// une heure précise pour tout le monde.
let offset = 0;
onValue(ref(db, ".info/serverTimeOffset"), (snap) => (offset = Number(snap.val()) || 0));

export const serverNow = () => Date.now() + offset;
