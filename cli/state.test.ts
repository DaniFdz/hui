import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, test } from "vitest";

const root = await mkdtemp(join(tmpdir(), "hui-cli-state-"));
process.env["XDG_CONFIG_HOME"] = root;
process.env["XDG_DATA_HOME"] = join(root, "data");
afterAll(() => rm(root, { recursive: true, force: true }));
const { withLifecycleLock, atomicJson, GATEWAY_DIR, STATE_FILE, readState } = await import("./state.ts");
const { gatewayStatus, stopGateway } = await import("./gateway.ts");
const { readPointer, updateDirectory, releaseRoot, assertUpdatable } = await import("./installation.ts");

test("lifecycle operations are exclusive and dead uniquely named locks can be reclaimed", async () => {
  await withLifecycleLock(async () => {
    await assert.rejects(withLifecycleLock(async () => {}), /in progress/u);
  });
  const lock = join(GATEWAY_DIR, "operation.lock");
  await mkdir(lock); await writeFile(join(lock, "2147483647-abcd"), "");
  await withLifecycleLock(async () => {});
  await assert.rejects(stat(lock), { code: "ENOENT" });
});

test("malformed gateway state cannot redirect control calls or signal another process", async () => {
  const state = { format: 1, pid: process.pid, instance: "fixture", token: "a".repeat(64), controlUrl: "http://127.0.0.1:1/",
    url: "http://127.0.0.1:4173/", host: "127.0.0.1", allowedHosts: [], port: 4173, version: "0.1.0", packageRoot: root, startedAt: "fixture" };
  await atomicJson(STATE_FILE, state);
  assert.equal((await stat(STATE_FILE)).mode & 0o777, 0o600);
  assert.equal((await gatewayStatus()).status, "unresponsive");
  await assert.rejects(stopGateway(true), /Refusing to signal/u);
  assert.equal((await readState())?.pid, process.pid);
  assert(!JSON.stringify(await gatewayStatus()).includes(state.token));
  for (const controlUrl of ["https://example.org/", "http://127.0.0.1:20/secret", "http://user:password@127.0.0.1:20/"]) {
    await atomicJson(STATE_FILE, { ...state, controlUrl }); await assert.rejects(readState);
  }
});

test("release pointers cannot escape their installation's managed directory", async () => {
  const directory = updateDirectory(root);
  await mkdir(directory, { recursive: true });
  assert.equal((await readPointer(root)).current, null);
  await atomicJson(join(directory, "current.json"), { format: 1, current: "../../elsewhere", previous: null, hasPrevious: true });
  await assert.rejects(readPointer(root), /arbitrary path/u);
  assert.equal(releaseRoot(root, null), root);
  await assert.rejects(assertUpdatable(root), /source checkout/u);
  assert.match(await readFile(join(directory, "current.json"), "utf8"), /elsewhere/u);
});

test("a wedged gateway ends on --force only when its command line is this installation's", async () => {
  const { spawn } = await import("node:child_process");
  const { join: joinPath } = await import("node:path");
  const fake = await mkdtemp(join(tmpdir(), "hui-wedged-gateway-"));
  await mkdir(joinPath(fake, "build/cli"), { recursive: true });
  await writeFile(joinPath(fake, "build/cli/gateway-run.js"), "setTimeout(() => {}, 60_000);\n");
  const child = spawn(process.execPath, [joinPath(fake, "build/cli/gateway-run.js")], { stdio: "ignore" });
  const state = { format: 1, pid: child.pid!, instance: "wedged", token: "b".repeat(64), controlUrl: "http://127.0.0.1:1/",
    url: "http://127.0.0.1:4173/", host: "127.0.0.1", allowedHosts: [], port: 4173, version: "0.1.0", packageRoot: fake, startedAt: "fixture" };
  const exit = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  try {
    await atomicJson(STATE_FILE, state);
    await assert.rejects(stopGateway(false), /Retry with --force/u, "a plain stop still refuses");
    assert.equal((await gatewayStatus()).status, "unresponsive");
    await stopGateway(true);
    await exit;
    await assert.rejects(stat(STATE_FILE), { code: "ENOENT" }, "the state file is cleared");
  } finally {
    child.kill("SIGKILL");
    await rm(fake, { recursive: true, force: true });
  }
});

test("--force still refuses a PID that is not this installation's gateway", async () => {
  const state = { format: 1, pid: process.pid, instance: "not-ours", token: "c".repeat(64), controlUrl: "http://127.0.0.1:1/",
    url: "http://127.0.0.1:4173/", host: "127.0.0.1", allowedHosts: [], port: 4173, version: "0.1.0", packageRoot: root, startedAt: "fixture" };
  await atomicJson(STATE_FILE, state);
  await assert.rejects(stopGateway(true), /Refusing to signal a recorded PID/u);
  assert.equal((await readState())?.pid, process.pid, "the running test process was not signalled");
});
