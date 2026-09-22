import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";

// Projet Firebase "relog-system" — hérité du K-OS v1.
// Clé client publique par design (sécurité assurée par les Realtime Database
// Rules côté serveur, pas par le secret de cette clé). Voir _archive/ pour
// l'historique et penser à restreindre les règles avant toute diffusion large.
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
