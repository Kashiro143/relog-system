// config.js - La Clé de Contact du K-OS System

// 1. Tes identifiants Firebase (à récupérer sur console.firebase.google.com)
export const firebaseConfig = {
    apiKey: "AIzaSyA6KWfJaMKOyy8KzJCRS6Went1vx_4S_MQ",
    authDomain: "relog-system.firebaseapp.com",
    databaseURL: "https://relog-system-default-rtdb.europe-west1.firebasedatabase.app",
    projectId: "relog-system",
    storageBucket: "relog-system.firebasestorage.app",
    messagingSenderId: "869109824129",
    appId: "1:869109824129:web:98565e8e25708461ef6b80",
    measurementId: "G-JRCCGTXMDN"
};

// 2. Paramètres de sécurité et versioning
export const SYSTEM_VERSION = "1.0.0-CORE";
export const DEBUG_MODE = true; // Affiche les logs dans la console

// 3. Chemins par défaut (Si tu veux changer l'organisation de tes dossiers)
export const PATHS = {
    modules: "/modules/",
    assets: "/assets/",
    icons: "/assets/icons/"
};

// 4. Liste des types de permissions (pour la Forge)
// Cela permet de ne pas faire de fautes de frappe dans la base de données
export const PERMISSION_TYPES = [
    "can_change_mode",
    "can_use_soundboard",
    "can_glitch",
    "can_edit_stats",
    "can_control_obs"
];