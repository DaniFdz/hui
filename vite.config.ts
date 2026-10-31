import { defineConfig } from "vite";

import { offlineBuild } from "./server/offline-build.ts";
import { huiConfig } from "./server/vite-plugin.ts";

export default defineConfig({
  plugins: [huiConfig(), offlineBuild()],
});
