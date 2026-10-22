/**
 * Builds what the iOS app bundles from this repository, for now the JavaScriptCore core: Vite bundles
 * `ios/core/entry.ts` into `ios/HUI/Resources/Generated/hui-core.js`, an IIFE that defines the global `HUICore`, and
 * writes `hui-core.sha256` beside it, a `shasum -a 256 -c` list (paths from the repository root) of the bundle and
 * every file it was built from, so the Xcode build can refuse a missing or stale bundle. With `--app` it then builds
 * the Release simulator app into `ios/build`, versioned as `package.json` is, and installs it on the "HUI iPhone" simulator, which must be booted, unless `--no-install` is passed too.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "vite";

const root = realpathSync(fileURLToPath(new URL("../", import.meta.url)));

export async function buildCore(outDir: string): Promise<void> {
  const outputs = await build({
    configFile: false,
    root,
    publicDir: false,
    logLevel: "warn",
    build: {
      outDir,
      emptyOutDir: false,
      lib: { entry: join(root, "ios/core/entry.ts"), formats: ["iife"], name: "HUICore", fileName: () => "hui-core.js" },
    },
  });
  if (!Array.isArray(outputs)) throw new Error("Vite did not return the core bundle");
  const sources = outputs.flatMap(({ output: [chunk] }) => chunk.moduleIds.filter((id) => !id.startsWith("\0")));
  const files = [...sources, join(root, "scripts/ios-build.ts"), join(outDir, "hui-core.js")].map((file) => relative(root, file)).sort();
  const lines = await Promise.all(files.map(async (file) => `${createHash("sha256").update(await readFile(join(root, file))).digest("hex")}  ${file}\n`));
  await writeFile(join(outDir, "hui-core.sha256"), lines.join(""));
}

const entry = process.argv[1];
if (import.meta.main ?? (entry !== undefined && import.meta.url === pathToFileURL(realpathSync(entry)).href)) {
  await buildCore(join(root, "ios/HUI/Resources/Generated"));
  if (process.argv.includes("--app")) {
    const { version } = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as { version: string };
    const run = (command: string, args: string[]) => execFileSync(command, args, { cwd: root, stdio: "inherit" });
    run("xcodebuild", ["-project", "ios/HUI.xcodeproj", "-scheme", "HUI", "-configuration", "Release", "-sdk", "iphonesimulator", "-destination", "generic/platform=iOS Simulator", "-derivedDataPath", "ios/build", "-quiet", `MARKETING_VERSION=${version}`]);
    if (!process.argv.includes("--no-install")) run("xcrun", ["simctl", "install", "HUI iPhone", "ios/build/Build/Products/Release-iphonesimulator/HUI.app"]);
  }
}
