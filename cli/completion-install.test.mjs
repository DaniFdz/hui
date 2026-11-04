import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { test } from "vitest";
import { COMPLETION_FILES, completionPrefix, installCompletions, prefixToInstall } from "./completion-install.mjs";

const exec = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));

test("a global install leaves both programs where each shell finds them", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "hui-completions-"));
  try {
    // The npm layout the postinstall runs from: <prefix>/lib/node_modules/hui/cli/.
    const packageRoot = join(temporary, "prefix/lib/node_modules/hui");
    await cp(join(here, "completion-install.mjs"), join(packageRoot, "cli/completion-install.mjs"));
    await cp(join(here, "completions"), join(packageRoot, "cli/completions"), { recursive: true });
    assert.equal(completionPrefix(packageRoot), join(temporary, "prefix"));
    assert.equal(completionPrefix(here), undefined, "a checkout has no prefix to install into");
    assert.equal(prefixToInstall([], { npm_config_global: "true" }), undefined, "this checkout is not installed");
    assert.equal(prefixToInstall(["/elsewhere"], { npm_config_global: "true" }), "/elsewhere");
    assert.equal(prefixToInstall([], {}), undefined);
    assert.equal(prefixToInstall([], { npm_config_global: "true", HUI_SKIP_COMPLETIONS: "1" }), undefined);

    await exec(process.execPath, [join(packageRoot, "cli/completion-install.mjs")], { env: { ...process.env, npm_config_global: "true" } });
    for (const [shell, relative] of Object.entries(COMPLETION_FILES)) {
      const installed = join(temporary, "prefix", relative);
      assert.equal(await readFile(installed, "utf8"), await readFile(join(here, "completions", shell === "bash" ? "hui.bash" : "_hui"), "utf8"));
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("an explicit prefix is installed into, and a checkout installs nothing", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "hui-completions-prefix-"));
  try {
    const written = await installCompletions(temporary);
    assert.deepEqual(written, [join(temporary, COMPLETION_FILES.bash), join(temporary, COMPLETION_FILES.zsh)]);
    // Importing the installer writes nothing; a checkout's own directory stays as it is.
    await assert.rejects(stat(join(here, "share")), { code: "ENOENT" });
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
