import { execFileSync } from "node:child_process";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

async function tests(directory) {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...await tests(path));
    else if (/\.test\.(?:ts|mjs|js)$/u.test(entry.name)) found.push(path);
  }
  return found;
}
const args = process.argv.slice(2);
const files = args.length ? args : (await Promise.all(["bin", "cli", "desktop", "evals", "server", "src"].map(tests))).flat().sort();
try { execFileSync(process.execPath, ["--test", ...files], { stdio: "inherit" }); }
catch (error) { process.exitCode = error.status ?? 1; }
