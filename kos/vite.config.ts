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
      },
    },
  },
});
