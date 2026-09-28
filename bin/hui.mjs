#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

try {
  if (!existsSync(new URL("../build/cli/launch.js", import.meta.url))) throw new Error("Package build is missing. In a checkout, run npm run build first.");
  const { launch } = await import("../build/cli/launch.js");
  await launch(fileURLToPath(new URL("../", import.meta.url)), process.argv.slice(2));
} catch (error) {
  console.error(`hui: ${error.message}`);
  process.exitCode = 1;
}
