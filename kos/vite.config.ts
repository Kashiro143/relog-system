import { defineConfig } from "vite";
import { resolve } from "path";

const root = import.meta.dirname;

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        index: resolve(root, "index.html"),
        forge: resolve(root, "forge.html"),
        master: resolve(root, "master.html"),
        overlay: resolve(root, "overlay.html"),
        player: resolve(root, "player.html"),
        kashiroTerminal: resolve(root, "kashiro-terminal.html"),
        terminalOverlay: resolve(root, "modules/terminal/overlay.html"),
        pokemmoOverlay: resolve(root, "modules/pokemmo/overlay.html"),
        pokemmoPlayer: resolve(root, "modules/pokemmo/player.html"),
      },
    },
  },
});
