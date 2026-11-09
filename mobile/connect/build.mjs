/**
 * Spike S1: copies the Connect page's three source files into the `webDir` Capacitor bundles
 * (`mobile/connect/dist`). No bundler: the page is plain HTML, CSS and JS.
 */
import { copyFileSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = join(here, "src");
const target = join(here, "dist");
mkdirSync(target, { recursive: true });
for (const file of readdirSync(source)) copyFileSync(join(source, file), join(target, file));
console.log(`connect page copied to ${resolve(target)}`);
