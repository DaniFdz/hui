/** Test runner behind `npm test`: runs the given files, or every *.test file under the source directories, with
 * Node's built-in test runner and passes its exit status through. */
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
const files = args.length ? args : (await Promise.all(["bin", "cli", "desktop", "evals", "scripts", "server", "src"].map(tests))).flat().sort();
// A test file or test that never ends fails after five minutes, far past the
// slowest one, and the log names it. Without a limit it holds the run open until
// CI cancels the job, and since node:test reports files in order, it also hides
// every result after it. Node 24 applies the limit to tests only: a file that
// never finishes loading, or that a handle holds open, still waits for the job's.
const TEST_TIMEOUT_MS = 300_000;
try { execFileSync(process.execPath, ["--test", `--test-timeout=${TEST_TIMEOUT_MS}`, ...files], { stdio: "inherit" }); }
catch (error) { process.exitCode = error.status ?? 1; }
