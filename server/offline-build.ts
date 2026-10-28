/**
 * Production-only Vite plugin behind offline reading: it stamps one build id
 * into the browser bundle as `__HUI_BUILD_ID__` and writes `offline-build.json`
 * plus the integrity manifest of every static file the offline worker installs.
 * A partial or failed build never reaches these files, so a browser can only
 * install a complete inventory.
 */
import { createHash, randomBytes } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import type { Plugin } from "vite";

const BUILD_MARKER_FILE = "offline-build.json";
const INVENTORY_FILE = "offline-inventory.json";
const MANIFEST_FILES = new Set([BUILD_MARKER_FILE, INVENTORY_FILE, "offline-worker.js"]);

type OfflineFile = { url: string; integrity: string };

async function writeOfflineFiles(outDir: string, build: string): Promise<void> {
  const files: OfflineFile[] = [];
  for (const entry of await readdir(outDir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path = relative(outDir, join(entry.parentPath, entry.name));
    if (MANIFEST_FILES.has(path)) continue;
    const bytes = await readFile(join(outDir, path));
    files.push({
      url: encodeURI(`/${path.split(sep).join("/")}`),
      integrity: `sha384-${createHash("sha384").update(bytes).digest("base64")}`,
    });
  }
  files.sort((left, right) => left.url < right.url ? -1 : left.url > right.url ? 1 : 0);
  const inventory = { build, files };
  await writeFile(join(outDir, BUILD_MARKER_FILE), `${JSON.stringify({ build })}\n`);
  await writeFile(join(outDir, INVENTORY_FILE), `${JSON.stringify(inventory)}\n`);
}

export function offlineBuild(): Plugin {
  let build = "";
  let outDir = "";
  return {
    name: "hui-offline-build",
    apply: "build",
    config() {
      build = randomBytes(8).toString("hex");
      return { define: { __HUI_BUILD_ID__: JSON.stringify(build) } };
    },
    configResolved(config) {
      outDir = isAbsolute(config.build.outDir) ? config.build.outDir : join(config.root, config.build.outDir);
    },
    async writeBundle() {
      await writeOfflineFiles(outDir, build);
    },
  };
}
