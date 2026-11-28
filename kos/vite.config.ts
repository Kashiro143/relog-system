import { defineConfig } from "vite";
import { resolve } from "path";

const root = import.meta.dirname;

export default defineConfig({
  // GitHub Pages sert un site de projet sous /<repo>/ : le workflow de déploiement fixe KOS_BASE.
  base: process.env.KOS_BASE ?? "/",
  build: {
    rollupOptions: {
      input: {
        index: resolve(root, "index.html"),
        forge: resolve(root, "forge.html"),
        master: resolve(root, "master.html"),
        overlay: resolve(root, "overlay.html"),
        module: resolve(root, "module.html"),
        obs: resolve(root, "obs.html"),
        voir: resolve(root, "voir.html"),
        compte: resolve(root, "compte.html"),
        player: resolve(root, "player.html"),
        login: resolve(root, "login.html"),
        relog: resolve(root, "relog.html"),
        room: resolve(root, "room.html"),
        watch: resolve(root, "watch.html"),
        kashiroTerminal: resolve(root, "kashiro-terminal.html"),
        terminalOverlay: resolve(root, "modules/terminal/overlay.html"),
        pokemmoOverlay: resolve(root, "modules/pokemmo/overlay.html"),
        pokemmoPlayer: resolve(root, "modules/pokemmo/player.html"),
      },
    },
  },
});
