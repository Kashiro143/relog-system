import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";
import { getAuth } from "firebase/auth";

// Projet Firebase "relog-system" — hérité du K-OS v1.
// Clé client publique par design : la sécurité vient des règles Realtime
// Database (firebase/database.rules.json), pas du secret de cette clé.
const firebaseConfig = {
  apiKey: "AIzaSyA6KWfJaMKOyy8KzJCRS6Went1vx_4S_MQ",
  authDomain: "relog-system.firebaseapp.com",
  databaseURL: "https://relog-system-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "relog-system",
  storageBucket: "relog-system.firebasestorage.app",
  messagingSenderId: "869109824129",
  appId: "1:869109824129:web:98565e8e25708461ef6b80",
  measurementId: "G-JRCCGTXMDN",
};

export const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
// Enregistré partout (y compris dans les modules chargés en iframe) pour que
// chaque écriture porte l'identité Google de la personne connectée.
export const auth = getAuth(app);
