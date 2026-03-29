// core.js - Le moteur universel de K-OS
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getDatabase, ref, onValue, set, onDisconnect } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";
import { firebaseConfig } from "./config.js";

class KOSCore {
    constructor() {
        this.app = initializeApp(firebaseConfig);
        this.db = getDatabase(this.app);
        this.user = new URLSearchParams(window.location.search).get('u') || 'GUEST';
        this.role = document.body.dataset.role; // 'master', 'player', ou 'overlay'
        
        this.init();
    }

    init() {
        console.log(`[K-OS] Initialisation pour : ${this.user} (${this.role})`);
        
        // 1. Signaler la présence (Heartbeat)
        if (this.role !== 'master' && this.user !== 'GUEST') {
            const statusRef = ref(this.db, `users/${this.user}/status`);
            set(statusRef, 'online');
            onDisconnect(statusRef).set('offline');
        }

        // 2. Écouter le changement de Mode
        onValue(ref(this.db, `users/${this.user}/currentMode`), (snapshot) => {
            const mode = snapshot.val();
            if (mode) this.switchModule(mode);
        });

        // 3. Écouter les Permissions
        onValue(ref(this.db, `users/${this.user}/permissions`), (snapshot) => {
            this.updatePermissions(snapshot.val() || {});
        });
    }

    switchModule(modeId) {
        console.log(`[K-OS] Changement de module : ${modeId}`);
        // Ici, on injectera le HTML du module dans une iframe ou une div
        const container = document.getElementById('module-container');
        if (container) {
            container.src = `modules/${modeId}/${this.role}.html?u=${this.user}`;
        }
    }

    updatePermissions(perms) {
        // Active ou désactive les boutons selon les droits
        Object.keys(perms).forEach(p => {
            const el = document.querySelector(`[data-perm="${p}"]`);
            if (el) el.style.display = perms[p] ? 'block' : 'none';
        });
    }
}

// Lancement du noyau
const KOS = new KOSCore();