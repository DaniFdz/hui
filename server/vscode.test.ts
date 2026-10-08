import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { waitFor } from "./test-support/wait-for.ts";
import {
  parseVscodeHelp, resolveVscodeExecutable, vscodeEnvironment, vscodeLaunchArguments, VscodeError, VscodeService,
  type VscodeProbe,
} from "./vscode.ts";
import type { VscodeSettings } from "../src/lib/settings.ts";

const FAKE = fileURLToPath(new URL("./test-support/fake-vscode-server.mjs", import.meta.url));
const OPENVSCODE_HELP = "OpenVSCode Server 1.109.5\n\nUsage: openvscode-server [options]\n  --server-base-path <path>\n  --connection-token-file <path>\n  --server-data-dir\n  --extensions-dir <dir>\n";
const CODE_SERVER_HELP = "code-server 4.96.4 abc123 with Code 1.96.4\n\nUsage: code-server [options] [path]\n  --bind-addr\n  --auth\n  --user-data-dir\n  --extensions-dir\n";

/** A launcher script named like the real binary and, like it, running node as a child rather than exec-ing it, so
 * detection, spawning and stopping go through the same process shape. */
async function fakeExecutable(dir: string, name = "openvscode-server"): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, `#!/bin/sh\n"${process.execPath}" "${FAKE}" "$@"\n`);
  await chmod(path, 0o755);
  return path;
}

function probe(files: Record<string, string | Error>, env: NodeJS.ProcessEnv = {}): VscodeProbe {
  return {
    platform: "linux",
    env,
    home: "/home/op",
    isExecutable: async (path) => path in files,
    help: async (path) => {
      const help = files[path];
      if (help instanceof Error) throw help;
      if (help === undefined) throw new Error("missing");
      return help;
    },
  };
}

test("the help banner names the server and the flags HUI needs decide compatibility", () => {
  assert.deepEqual(parseVscodeHelp("/bin/openvscode-server", OPENVSCODE_HELP), { name: "OpenVSCode Server", version: "1.109.5" });
  const codeServer = parseVscodeHelp("/bin/code-server", CODE_SERVER_HELP);
  assert.ok("error" in codeServer);
  assert.match(codeServer.error, /^code-server 4\.96\.4 at \/bin\/code-server cannot run behind HUI: it has no --server-base-path, --connection-token-file, --server-data-dir\. Install openvscode-server\.$/u);
});

test("detection prefers openvscode-server on PATH and the extra package-manager directories", async () => {
  const found = await resolveVscodeExecutable("", probe({ "/opt/tools/openvscode-server": OPENVSCODE_HELP }, { PATH: "/usr/bin:/opt/tools", USER: "op" }));
  assert.deepEqual(found, { executable: { path: "/opt/tools/openvscode-server", name: "OpenVSCode Server", version: "1.109.5", source: "detected" } });
  const nix = await resolveVscodeExecutable("", probe({ "/etc/profiles/per-user/op/bin/openvscode-server": OPENVSCODE_HELP }, { PATH: "/usr/bin", USER: "op" }));
  assert.equal(nix.executable?.path, "/etc/profiles/per-user/op/bin/openvscode-server");
  const brew = await resolveVscodeExecutable("", probe({ "/opt/homebrew/bin/openvscode-server": OPENVSCODE_HELP }, { PATH: "/usr/bin" }));
  assert.equal(brew.executable?.path, "/opt/homebrew/bin/openvscode-server");
});

test("code-server is used only when its CLI is compatible, and otherwise named in the reason", async () => {
  const incompatible = await resolveVscodeExecutable("", probe({ "/usr/bin/code-server": CODE_SERVER_HELP }, { PATH: "/usr/bin" }));
  assert.equal(incompatible.executable, null);
  assert.match(incompatible.error ?? "", /^No compatible VS Code server was found\. code-server 4\.96\.4 at \/usr\/bin\/code-server cannot run behind HUI/u);
  const compatible = await resolveVscodeExecutable("", probe({ "/usr/bin/code-server": OPENVSCODE_HELP.replace("OpenVSCode Server", "code-server") }, { PATH: "/usr/bin" }));
  assert.equal(compatible.executable?.path, "/usr/bin/code-server");
  const none = await resolveVscodeExecutable("", probe({}, { PATH: "/usr/bin" }));
  assert.equal(none.error, "openvscode-server was not found on PATH. Install it, or set its path in Settings → Tools → VS Code.");
});

test("a configured path is checked as given, never replaced by a detected one", async () => {
  const files = { "/srv/ovs/bin/openvscode-server": OPENVSCODE_HELP, "/usr/bin/openvscode-server": OPENVSCODE_HELP, "/bin/broken": new Error("spawn EACCES\nmore") };
  assert.deepEqual(await resolveVscodeExecutable("/srv/ovs/bin/openvscode-server", probe(files, { PATH: "/usr/bin" })), {
    executable: { path: "/srv/ovs/bin/openvscode-server", name: "OpenVSCode Server", version: "1.109.5", source: "configured" },
  });
  assert.equal((await resolveVscodeExecutable("~/ovs", probe({ "/home/op/ovs": OPENVSCODE_HELP }))).executable?.path, "/home/op/ovs");
  assert.equal((await resolveVscodeExecutable("bin/openvscode-server", probe(files))).error, "The VS Code executable must be an absolute path.");
  assert.equal((await resolveVscodeExecutable("/nope/openvscode-server", probe(files, { PATH: "/usr/bin" }))).error, "No executable was found at /nope/openvscode-server.");
  assert.equal((await resolveVscodeExecutable("/bin/broken", probe(files))).error, "/bin/broken did not run: spawn EACCES");
});

test("the launch flags bind loopback, keep the token in a file and put state in HUI's directory", () => {
  const args = vscodeLaunchArguments({ port: 4100, tokenFile: "/c/hui/vscode/connection-token", dir: "/c/hui/vscode" });
  assert.deepEqual(args, [
    "--host", "127.0.0.1", "--port", "4100", "--connection-token-file", "/c/hui/vscode/connection-token",
    "--server-base-path", "/__hui/vscode", "--server-data-dir", "/c/hui/vscode/server-data", "--user-data-dir", "/c/hui/vscode/user-data",
    "--extensions-dir", "/c/hui/vscode/extensions", "--accept-server-license-terms", "--telemetry-level", "off",
  ]);
  assert.ok(!args.some((arg) => arg.startsWith("--connection-token=") || arg === "--connection-token"), "the token never appears in argv");
  assert.deepEqual(vscodeEnvironment({ PATH: "/bin", HUI_AGENT_BRIDGE_TOKEN: "x", VSCODE_IPC_HOOK_CLI: "/tmp/s", HOME: "/h" }), { PATH: "/bin", HOME: "/h" });
});

function service(dir: string, settings: () => VscodeSettings, extra: Partial<ConstructorParameters<typeof VscodeService>[0]> = {}) {
  return new VscodeService({ dir: join(dir, "state"), settings: async () => settings(), readyTimeoutMs: 15_000, ...extra });
}

test("the server starts lazily, once, and reports what it runs", { timeout: 60_000 }, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "hui-vscode-life-"));
  const executable = await fakeExecutable(dir);
  const argsFile = join(dir, "args.json");
  const vscode = service(dir, () => ({ enabled: true, executable }), { env: () => ({ ...process.env, FAKE_VSCODE_ARGS_FILE: argsFile }) });
  t.after(async () => { await vscode.stop(); await rm(dir, { recursive: true, force: true }); });

  const before = await vscode.status();
  assert.equal(before.state, "stopped", "nothing runs until a view opens");
  assert.deepEqual(before.executable, { path: executable, name: "OpenVSCode Server", version: "9.8.7", source: "configured" });
  const [first, second] = await Promise.all([vscode.ensure(), vscode.ensure()]);
  assert.equal(first, second, "concurrent opens share one start");
  assert.equal(first.instance, 1);
  const running = await vscode.status();
  assert.equal(running.state, "running");
  assert.ok(running.pid && running.startedAt);
  const { args, pid: node } = JSON.parse(await readFile(argsFile, "utf8")) as { args: string[]; pid: number };
  assert.equal(args[args.indexOf("--port") + 1], String(first.port));
  assert.notEqual(node, running.pid, "the server runs below its launcher script");
  assert.equal(await readFile(vscode.tokenFile, "utf8"), first.token);
  assert.equal((await stat(vscode.tokenFile)).mode & 0o777, 0o600);
  assert.equal((await stat(vscode.dir)).mode & 0o777, 0o700);
  assert.equal((await vscode.ensure()).port, first.port, "a running server is reused");
  await vscode.stop();
  assert.equal(alive(node), false, "stopping reaches the server behind the launcher, not only the script");
});

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

test("a server with no connections stops after the idle period; a connection holds it", { timeout: 60_000 }, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "hui-vscode-idle-"));
  const executable = await fakeExecutable(dir);
  const vscode = service(dir, () => ({ enabled: true, executable }), { idleMs: 150 });
  t.after(async () => { await vscode.stop(); await rm(dir, { recursive: true, force: true }); });

  await vscode.ensure();
  const release = vscode.acquire();
  await new Promise((resolve) => setTimeout(resolve, 400));
  assert.equal((await vscode.status()).state, "running", "an open connection keeps it running");
  release();
  await waitFor("idle stop", async () => (await vscode.status()).state === "stopped");
  assert.equal((await vscode.status()).lastError, "", "an idle stop is not an error");
  assert.equal((await vscode.ensure()).instance, 2, "the next open starts it again");
});

test("a crash is reported, not restarted, and the next open starts a new instance", { timeout: 60_000 }, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "hui-vscode-crash-"));
  const executable = await fakeExecutable(dir);
  const argsFile = join(dir, "args.json");
  const vscode = service(dir, () => ({ enabled: true, executable }), { env: () => ({ ...process.env, FAKE_VSCODE_ARGS_FILE: argsFile }) });
  t.after(async () => { await vscode.stop(); await rm(dir, { recursive: true, force: true }); });

  await vscode.ensure();
  const { pid: node } = JSON.parse(await readFile(argsFile, "utf8")) as { pid: number };
  process.kill(node, "SIGKILL");
  const failed = await waitFor("crash report", async () => { const status = await vscode.status(); return status.state === "failed" ? status : undefined; });
  assert.match(failed.lastError, /^VS Code exited unexpectedly \(exit code 137\)/u, "the launcher reports node's death");
  assert.doesNotMatch(failed.lastError, /Extension host agent listening/u, "routine stdout is not presented as the error");
  assert.equal(vscode.current(), undefined, "a crashed server is not offered to the proxy");
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal((await vscode.status()).state, "failed", "nothing restarts it on its own");
  const again = await vscode.ensure();
  assert.equal(again.instance, 2);
  assert.equal((await vscode.status()).lastError, "");

  // The launcher dying alone takes the rest of its process group with it.
  const { pid: second } = JSON.parse(await readFile(argsFile, "utf8")) as { pid: number };
  const { pid: launcher } = await vscode.status();
  assert.ok(launcher);
  process.kill(launcher, "SIGKILL");
  await waitFor("the orphaned server to be reaped", () => !alive(second));
  assert.equal((await vscode.status()).state, "failed");
});

test("a start that fails says why, and so does a disabled or missing server", { timeout: 60_000 }, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "hui-vscode-fail-"));
  const executable = await fakeExecutable(dir);
  let settings: VscodeSettings = { enabled: true, executable };
  const vscode = service(dir, () => settings, { env: () => ({ ...process.env, FAKE_VSCODE_FAIL: "no display of extensions" }) });
  t.after(async () => { await vscode.stop(); await rm(dir, { recursive: true, force: true }); });

  await assert.rejects(vscode.ensure(), (error: unknown) => error instanceof VscodeError && error.status === 502
    && /^OpenVSCode Server exited while starting \(exit code 7\): fake failure: no display of extensions$/u.test(error.message));
  assert.equal((await vscode.status()).state, "failed");
  settings = { enabled: false, executable };
  await assert.rejects(vscode.ensure(), (error: unknown) => error instanceof VscodeError && error.code === "disabled");
  assert.equal((await vscode.status()).state, "off");
  settings = { enabled: true, executable: join(dir, "missing") };
  await assert.rejects(vscode.ensure(), (error: unknown) => error instanceof VscodeError && error.code === "not-found");
  const status = await vscode.status();
  assert.equal(status.state, "unavailable");
  assert.equal(status.executableError, `No executable was found at ${join(dir, "missing")}.`);
});

test("tickets are single-use and short-lived; cookie secrets expire and forged ones fail", { timeout: 60_000 }, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "hui-vscode-ticket-"));
  const executable = await fakeExecutable(dir);
  let now = 1_000_000;
  const vscode = service(dir, () => ({ enabled: true, executable }), { now: () => now, ticketMs: 30_000, sessionMs: 60_000 });
  t.after(async () => { await vscode.stop(); await rm(dir, { recursive: true, force: true }); });

  const theme = { background: "#101010", panel: "#202020", elevated: "#303030", text: "#eeeeee" };
  const connection = await vscode.connect("/work/repo", theme);
  assert.match(connection.url, /^\/__hui\/vscode\/enter\?ticket=[\w-]{43}$/u);
  assert.equal(connection.folder, "/work/repo");
  const ticket = new URL(connection.url, "http://h").searchParams.get("ticket") ?? "";
  const entered = vscode.enter(ticket);
  assert.ok(entered);
  assert.equal(entered.folder, "/work/repo");
  assert.equal(vscode.enter(ticket), undefined, "a ticket works once");
  assert.deepEqual(vscode.session([entered.secret])?.theme, theme);
  assert.equal(vscode.session(["forged", entered.secret.replace(/^./u, (c) => (c === "A" ? "B" : "A"))]), undefined);
  assert.ok(vscode.session(["forged", entered.secret]), "any valid secret among several cookies is enough");

  const late = new URL((await vscode.connect("/work/repo", undefined)).url, "http://h").searchParams.get("ticket") ?? "";
  now += 30_001;
  assert.equal(vscode.enter(late), undefined, "an expired ticket fails");
  assert.ok(vscode.session([entered.secret]), "30 seconds later the cookie session is still valid");
  now += 59_000;
  assert.ok(vscode.session([entered.secret]), "use refreshes a cookie session");
  now += 60_001;
  assert.equal(vscode.session([entered.secret]), undefined, "an unused cookie session expires");

  const kept = vscode.enter(new URL((await vscode.connect("/work/repo", undefined)).url, "http://h").searchParams.get("ticket") ?? "");
  assert.ok(kept);
  await vscode.applySettings({ enabled: false, executable });
  assert.equal(vscode.session([kept.secret]), undefined, "turning VS Code off withdraws every cookie");
  assert.equal((await vscode.status()).state, "stopped", "and stops the server");
});

test("a new executable stops the running server; disposing returns at once and the server exits", { timeout: 60_000 }, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "hui-vscode-dispose-"));
  const executable = await fakeExecutable(dir);
  const other = await fakeExecutable(dir, "other-openvscode-server");
  const vscode = service(dir, () => ({ enabled: true, executable }));
  t.after(() => rm(dir, { recursive: true, force: true }));

  await vscode.ensure();
  await vscode.applySettings({ enabled: true, executable });
  assert.equal((await vscode.status()).state, "running", "the same settings keep it");
  await vscode.applySettings({ enabled: true, executable: other });
  assert.equal((await vscode.status()).state, "stopped");
  await vscode.ensure();
  const { pid } = await vscode.status();
  assert.ok(pid);
  const started = performance.now();
  vscode.dispose();
  assert.ok(performance.now() - started < 50, "dispose does not wait for the process");
  await waitFor("the server process to exit", () => !alive(pid));
  await assert.rejects(vscode.ensure(), /gateway is stopping/u);
});

test("a server a killed gateway left behind is stopped before the next start", { timeout: 60_000 }, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "hui-vscode-reap-"));
  const executable = await fakeExecutable(dir);
  const first = service(dir, () => ({ enabled: true, executable }));
  await first.ensure();
  const { pid } = await first.status();
  assert.ok(pid);
  const second = service(dir, () => ({ enabled: true, executable }));
  t.after(async () => { await second.stop(); try { process.kill(-pid, "SIGKILL"); } catch { /* gone */ } await rm(dir, { recursive: true, force: true }); });
  await waitFor("the pid file", () => readFile(join(dir, "state", "server.json"), "utf8").then(() => true, () => false));
  await second.ensure();
  await waitFor("the orphaned server to exit", () => !alive(pid));
});
