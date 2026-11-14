/** The Connect page's Vite build: `mobile/connect/index.html` and `src/` into Capacitor's `webDir`, `dist/`. */
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const here = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root: here,
  // The page runs in a WebView that ships with the app, so the target is the WebView's Chromium, not the oldest browser.
  build: { outDir: `${here}dist`, emptyOutDir: true, target: "chrome120", sourcemap: false },
});
