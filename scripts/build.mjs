/** Produces the package build: compiles the server and CLI, bundles the web app, copies themes and skills, and stamps
 * the release marker that installs and updates verify. It writes generated output only; the repository lockfile is
 * copied to npm-shrinkwrap.json for the package, never changed. */
import { execFileSync } from "node:child_process";
import { cp, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
// This is generated output, never a configuration or user-data directory.
await rm(new URL("../build/", import.meta.url), { recursive: true, force: true });
for (const [script, args] of [
  ["typescript/bin/tsc", ["-p", "tsconfig.server.json"]],
  ["vite/bin/vite.js", ["build"]],
]) execFileSync(process.execPath, [`${root}node_modules/${script}`, ...args], { cwd: root, stdio: "inherit" });
await cp(new URL("../themes/", import.meta.url), new URL("../build/themes/", import.meta.url), { recursive: true });
await cp(new URL("../skills/", import.meta.url), new URL("../build/skills/", import.meta.url), { recursive: true });
// Published CLIs honor shrinkwrap; ordinary dependency package-lock files are
// excluded by npm pack. Ship the verified graph without changing the repo lock.
await cp(new URL("../package-lock.json", import.meta.url), new URL("../npm-shrinkwrap.json", import.meta.url));
await writeFile(new URL("../build/release.json", import.meta.url), JSON.stringify({ format: 1, version: pkg.version }) + "\n");
