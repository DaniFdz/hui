import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

const [output, shell, mode] = process.argv.slice(2);
const root = join(output, "lib/node_modules/hui");
const temporary = await mkdtemp(join(tmpdir(), "hui-nix-smoke-"));
const env = { ...process.env, HOME: temporary, XDG_CONFIG_HOME: join(temporary, "config"),
  XDG_DATA_HOME: join(temporary, "data"), PI_CODING_AGENT_DIR: join(temporary, "pi"),
  HUI_PI_BACKEND: "sdk", SHELL: shell };
for (const key of ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NODE_USE_ENV_PROXY"]) { delete env[key]; delete process.env[key]; }
Object.assign(process.env, env);
const exec = promisify(execFile);
const cli = async (...args) => (await exec(join(output, "bin/hui"), args, { env, cwd: temporary, timeout: 30_000 })).stdout.trim();
try {
  const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  assert.equal(await cli("--version"), pkg.version);
  assert.match(await cli("--help"), /hui gateway/);
  await assert.rejects(cli("update", "--rollback"), /managed by Nix/);
  await assert.rejects(cli("desktop"), /web-only/);

  const require = createRequire(join(root, "package.json"));
  // Prove that the patched native PTY really executes a shell, not only imports.
  const { spawn } = require("@lydell/node-pty");
  await new Promise((resolve, reject) => {
    const terminal = spawn(shell, ["-c", "printf hui-nix-pty"], { cwd: temporary, env });
    let text = "";
    const timer = setTimeout(() => { terminal.kill(); reject(new Error("PTY timed out")); }, 10_000);
    terminal.onData((data) => { text += data; });
    terminal.onExit(({ exitCode }) => {
      clearTimeout(timer);
      try { assert.equal(exitCode, 0); assert.match(text, /hui-nix-pty/); resolve(); }
      catch (error) { reject(error); }
    });
  });
  // Both PI entrypoints must survive dependency pruning and offline packaging.
  const piRoot = join(root, "node_modules/@earendil-works/pi-coding-agent");
  const piPackage = JSON.parse(await readFile(join(piRoot, "package.json"), "utf8"));
  const sdk = await import(pathToFileURL(join(piRoot, piPackage.exports["."].import)).href);
  assert.equal(typeof sdk.createAgentSession, "function");
  const pi = join(root, "node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js");
  assert.equal((await exec(process.execPath, [pi, "--version"], { env, cwd: temporary, timeout: 30_000 })).stdout.trim(), piPackage.version);

  const state = JSON.parse(await cli("gateway", "start", ...(mode === "configured" ? [] : ["--port", "0"]), "--json"));
  if (mode === "configured") {
    assert.equal(new URL(state.url).hostname, "127.0.0.2");
    assert.equal(new URL(state.url).port, "5187");
  }
  assert.equal(state.status, "running");
  assert.equal(JSON.parse(await cli("gateway", "status", "--json")).status, "running");
  const response = await fetch(state.url, { signal: AbortSignal.timeout(5_000) });
  assert.equal(response.status, 200);
  assert.match(await response.text(), /<hui-app/);
  assert.equal(await cli("ui", "--no-open"), state.url);
  await cli("gateway", "stop", "--json");
  assert.equal(JSON.parse(await cli("gateway", "status", "--json")).status, "stopped");
  console.log("Nix package: CLI, update guard, native PTY, PI SDK/CLI and web gateway passed.");
} finally {
  await cli("gateway", "stop", "--force").catch(() => {});
  await rm(temporary, { recursive: true, force: true });
}
