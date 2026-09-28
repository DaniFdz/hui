import { defineConfig } from "vite";

import { huiConfig } from "./server/hui.ts";

export default defineConfig({
  plugins: [huiConfig()],
});
