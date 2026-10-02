import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";

import { parseWatchers, watcherStateLabel } from "../shared/watchers.ts";
import {
  WatcherConflictError,
  WatcherInputError,
  WatcherNotFoundError,
  WatcherService,
  WatcherStoreError,
  watcherScript,
  type WatcherServiceOptions,
} from "./watchers.ts";

async function waitFor(check: () => boolean, timeoutMs = 8_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await delay(25);
  }
  assert.fail("condition was not reached before the timeout");
}

function processGroupAlive(pid: number): boolean {
  try {
    process.kill(-pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function fixture(t: { after: (fn: () => Promise<void> | void) => void }, options: Partial<WatcherServiceOptions> = {}) {
  const dir = await mkdtemp(join(tmpdir(), "hui-watchers-"));
  const changes: string[] = [];
  let next = 0;
  const service = new WatcherService({
    file: join(dir, "watchers.json"),
    logDir: join(dir, "logs"),
    onChange: (id) => changes.push(id),
    uuid: () => `w-${++next}`,
    pollMs: 50,
    ...options,
  });
  await service.initialize();
  t.after(async () => {
    service.dispose();
    await rm(dir, { recursive: true, force: true });
  });
  return { dir, service, changes };
}

test("start records a running watcher, lists newest first and notifies", async (t) => {
  const { service, changes } = await fixture(t);
  const first = await service.start("alpha", {
    purpose: "Wait for #21532 approval",
    target: "https://github.com/ddoghq/web-ui/pull/21532",
    outcome: "post /merge",
    command: "sleep 30",
  });
  assert.equal(first.state, "running");
  assert.equal(first.exitCode, undefined);
  assert.match(first.logPath, /w-1\.log$/u);
  assert.ok(first.pid && first.pid > 1);
  assert.equal((await stat(first.logPath)).mode & 0o777, 0o600);
  assert.equal((await stat(first.logPath.replace(/\.log$/u, ".sh"))).mode & 0o777, 0o700);

  const second = await service.start("alpha", { purpose: "Second", command: "sleep 30" });
  assert.equal(second.state, "running");
  assert.deepEqual(service.list("alpha").map(({ id }) => id), ["w-2", "w-1"]);
  assert.deepEqual(service.list("beta"), []);
  assert.deepEqual(changes, ["alpha", "alpha"]);
  assert.deepEqual(await service.tool("alpha", { action: "list" }), { watchers: service.list("alpha") });

  const stored = JSON.parse(await readFile(join(first.logPath, "..", "..", "watchers.json"), "utf8")) as {
    watchers: Array<{ id: string; pid: number }>;
  };
  assert.deepEqual(stored.watchers.map(({ id }) => id), ["w-1", "w-2"]);

  await service.stop("alpha", "w-1");
  await service.stop("alpha", "w-2");
});

test("a finished command reports done or failed with its exit code and output", async (t) => {
  const { service } = await fixture(t);
  await service.start("alpha", { purpose: "Quick success", command: "printf 'hello watcher\\n'" });
  await waitFor(() => service.list("alpha")[0]?.state === "done");
  const done = service.list("alpha")[0]!;
  assert.equal(done.exitCode, 0);
  assert.equal(done.lastLine, "hello watcher");
  assert.ok(done.endedAt);

  await service.start("alpha", { purpose: "Quick failure", command: "printf 'boom\\n'; exit 3" });
  await waitFor(() => service.list("alpha")[0]?.state === "failed");
  const failed = service.list("alpha")[0]!;
  assert.equal(failed.exitCode, 3);
  assert.equal(failed.lastLine, "boom");
  assert.equal(watcherStateLabel(failed), "Failed (exit 3)");

  const log = await service.log("alpha", done.id, 10);
  assert.deepEqual(log.lines, ["hello watcher"]);
  assert.equal(log.truncated, false);
});

test("a recorded PID that is not the started process is dead, not running", async (t) => {
  const { service } = await fixture(t, {
    launch: () => 424_242,
    ownsProcess: async () => false,
    signalGroup: () => {},
    settleMs: 0,
  });
  const watcher = await service.start("alpha", { purpose: "Reboot victim", command: "sleep 30" });
  assert.equal(watcher.state, "dead");
  assert.equal(watcher.pid, 424_242);
  assert.equal(watcherStateLabel(watcher), "Dead · no exit recorded");
});

test("stop kills the whole process group and reports stopped", async (t) => {
  const { service } = await fixture(t);
  const watcher = await service.start("alpha", { purpose: "Long wait", command: "sleep 30" });
  const pid = watcher.pid!;
  const stopped = await service.stop("alpha", watcher.id);
  assert.equal(stopped.state, "stopped");
  assert.ok(stopped.endedAt);
  await waitFor(() => !processGroupAlive(pid));
  // Stopping an already settled watcher changes nothing.
  assert.equal((await service.stop("alpha", watcher.id)).state, "stopped");
});

test("a watcher that ignores SIGTERM is killed with SIGKILL", async (t) => {
  const { service } = await fixture(t);
  const watcher = await service.start("alpha", { purpose: "Stubborn", command: "trap '' TERM; while true; do sleep 1; done" });
  const pid = watcher.pid!;
  const stopped = await service.stop("alpha", watcher.id);
  assert.equal(stopped.state, "stopped");
  await waitFor(() => !processGroupAlive(pid));
});

test("restart respawns a settled watcher and is refused while running", async (t) => {
  const { service } = await fixture(t);
  const watcher = await service.start("alpha", { purpose: "Restartable", command: "printf 'first\\n'" });
  await waitFor(() => service.list("alpha")[0]?.state === "done");
  const restarted = await service.restart("alpha", watcher.id);
  assert.notEqual(restarted.pid, watcher.pid);
  assert.equal(restarted.startedAt >= watcher.startedAt, true);
  await waitFor(() => service.list("alpha")[0]?.state === "done");
  assert.equal(service.list("alpha")[0]?.lastLine, "first");

  const running = await service.start("alpha", { purpose: "Busy", command: "sleep 30" });
  await assert.rejects(service.restart("alpha", running.id), WatcherConflictError);
  await service.stop("alpha", running.id);
});

test("remove deletes a settled watcher and its files, but never a running one", async (t) => {
  const { service } = await fixture(t);
  const watcher = await service.start("alpha", { purpose: "Removable", command: "printf 'bye\\n'" });
  await waitFor(() => service.list("alpha")[0]?.state === "done");
  await assert.rejects(service.remove("alpha", watcher.id + "-missing"), WatcherNotFoundError);
  await service.remove("alpha", watcher.id);
  assert.deepEqual(service.list("alpha"), []);
  await assert.rejects(readFile(watcher.logPath, "utf8"), /ENOENT/u);

  const running = await service.start("alpha", { purpose: "Still running", command: "sleep 30" });
  await assert.rejects(service.remove("alpha", running.id), WatcherConflictError);
  await service.stop("alpha", running.id);
});

test("watchers are scoped to their conversation and bounded per conversation", async (t) => {
  const { service } = await fixture(t, { launch: () => 424_242, ownsProcess: async () => false, signalGroup: () => {} });
  const watcher = await service.start("alpha", { purpose: "Scoped", command: "sleep 1" });
  await assert.rejects(service.log("beta", watcher.id), WatcherNotFoundError);
  await assert.rejects(service.stop("beta", watcher.id), WatcherNotFoundError);
  for (let index = 1; index < 10; index += 1) await service.start("alpha", { purpose: `Extra ${index}`, command: "sleep 1" });
  await assert.rejects(service.start("alpha", { purpose: "One too many", command: "sleep 1" }), /already has 10 watchers/u);
  await service.start("beta", { purpose: "Other conversation", command: "sleep 1" });
});

test("start rejects malformed input before spawning anything", async (t) => {
  let launches = 0;
  const { service } = await fixture(t, { launch: () => { launches += 1; return 424_242; }, signalGroup: () => {} });
  await assert.rejects(service.start("alpha", { purpose: " ", command: "true" }), /purpose must not be empty/u);
  await assert.rejects(service.start("alpha", { purpose: "Missing command" }), /command must be text/u);
  await assert.rejects(service.start("alpha", { purpose: "Long", command: "x".repeat(4_001) }), /at most 4000/u);
  await assert.rejects(service.start("alpha", { purpose: "Bad target", command: "true", target: "not-a-url" }), /http\(s\) URL/u);
  await assert.rejects(service.tool("alpha", { action: "nope" }), WatcherInputError);
  await assert.rejects(service.tool("alpha", { action: "log", id: "w-1", lines: 0 }), /lines must be between/u);
  assert.equal(launches, 0);
});

test("a watcher whose registry write fails is stopped, not left orphaned", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "hui-watchers-orphan-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const readonly = join(dir, "readonly");
  await mkdir(readonly, { recursive: true, mode: 0o500 });
  const signals: Array<{ pid: number; signal: NodeJS.Signals }> = [];
  const service = new WatcherService({
    file: join(readonly, "watchers.json"),
    logDir: join(dir, "logs"),
    uuid: () => "w-bad",
    launch: () => 424_242,
    ownsProcess: async () => true,
    signalGroup: (pid, signal) => signals.push({ pid, signal }),
    settleMs: 0,
    pollMs: 50,
  });
  await service.initialize();
  t.after(() => service.dispose());
  await assert.rejects(service.start("alpha", { purpose: "Doomed", command: "sleep 1" }), WatcherStoreError);
  assert.deepEqual(signals, [{ pid: 424_242, signal: "SIGKILL" }]);
  assert.deepEqual(service.list("alpha"), []);
});

test("the command runs in the conversation's directory", async (t) => {
  const { dir, service } = await fixture(t);
  await writeFile(join(dir, "marker.txt"), "");
  await service.start("alpha", { purpose: "Where am I", command: "test -f marker.txt && echo found" }, dir);
  await waitFor(() => service.list("alpha")[0]?.state === "done");
  assert.equal(service.list("alpha")[0]?.lastLine, "found");
  await assert.rejects(
    service.start("alpha", { purpose: "Nowhere", command: "true" }, join(dir, "missing")),
    /directory is unavailable/u,
  );
});

test("initialize reconciles a registry written by a previous gateway", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "hui-watchers-restart-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, "watchers.json");
  const logDir = join(dir, "logs");
  await mkdir(logDir, { recursive: true });
  const record = (id: string) => ({
    id, sessionId: "alpha", purpose: "Recovered", target: "", outcome: "",
    command: "sleep 30", logPath: join(logDir, `${id}.log`), pid: 111_111,
    startedAt: new Date(Date.now() - 60_000).toISOString(),
  });
  await writeFile(file, JSON.stringify({ version: 1, watchers: [record("running"), record("gone")] }));
  await writeFile(join(logDir, "gone.exit"), "0\n");
  await writeFile(join(logDir, "gone.log"), "posted /merge\n");
  const service = new WatcherService({
    file, logDir,
    ownsProcess: async () => false,
    signalGroup: () => {},
  });
  await service.initialize();
  service.dispose();
  const byId = new Map(service.list("alpha").map((watcher) => [watcher.id, watcher]));
  assert.equal(byId.get("running")?.state, "dead");
  assert.equal(byId.get("gone")?.state, "done");
  assert.equal(byId.get("gone")?.lastLine, "posted /merge");
});

test("log returns a bounded tail and forget takes a deleted conversation's watchers", async (t) => {
  const { service } = await fixture(t);
  const watcher = await service.start("alpha", { purpose: "Loud", command: "seq 1 300" });
  await waitFor(() => service.list("alpha")[0]?.state === "done");
  const log = await service.log("alpha", watcher.id, 100);
  assert.equal(log.lines.length, 100);
  assert.equal(log.lines[0], "201");
  assert.equal(log.truncated, true);
  assert.equal(service.list("alpha")[0]?.lastLine, "300");

  const runner = await service.start("alpha", { purpose: "Forgotten", command: "sleep 30" });
  const pid = runner.pid!;
  await service.forget(["alpha"]);
  assert.deepEqual(service.list("alpha"), []);
  await waitFor(() => !processGroupAlive(pid));
  const stored = JSON.parse(await readFile(join(watcher.logPath, "..", "..", "watchers.json"), "utf8")) as { watchers: unknown[] };
  assert.deepEqual(stored.watchers, []);
});

test("a corrupt registry fails initialize without starting, and a retry recovers", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "hui-watchers-corrupt-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, "watchers.json");
  await writeFile(file, "not json");
  const service = new WatcherService({ file, logDir: join(dir, "logs"), ownsProcess: async () => false, signalGroup: () => {} });
  t.after(() => service.dispose());
  await assert.rejects(service.initialize(), WatcherStoreError);
  await writeFile(file, JSON.stringify({ version: 1, watchers: [] }));
  await service.initialize();
  assert.deepEqual(service.list("alpha"), []);
});

test("concurrent restarts launch one process and the second is refused", async (t) => {
  const { service } = await fixture(t);
  const watcher = await service.start("alpha", { purpose: "Contended", command: "sleep 30" });
  await service.stop("alpha", watcher.id);
  const results = await Promise.allSettled([
    service.restart("alpha", watcher.id),
    service.restart("alpha", watcher.id),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  const rejected = results.find((result) => result.status === "rejected") as PromiseRejectedResult;
  assert.ok(rejected.reason instanceof WatcherConflictError);
  await service.stop("alpha", watcher.id);
});

test("concurrent starts cannot exceed the per-conversation cap", async (t) => {
  const { service } = await fixture(t, { launch: () => 424_242, ownsProcess: async () => false, signalGroup: () => {}, settleMs: 0 });
  for (let index = 0; index < 9; index += 1) await service.start("alpha", { purpose: `Existing ${index}`, command: "sleep 1" });
  const results = await Promise.allSettled([
    service.start("alpha", { purpose: "Tenth", command: "sleep 1" }),
    service.start("alpha", { purpose: "Eleventh", command: "sleep 1" }),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(service.list("alpha").length, 10);
});

test("prune stops and forgets watchers whose conversation is gone", async (t) => {
  const { service } = await fixture(t);
  const kept = await service.start("alpha", { purpose: "Kept", command: "sleep 30" });
  const orphan = await service.start("beta", { purpose: "Orphan", command: "sleep 30" });
  const orphanPid = orphan.pid!;
  await service.prune(new Set(["alpha"]));
  assert.deepEqual(service.list("beta"), []);
  assert.deepEqual(service.list("alpha").map(({ id }) => id), [kept.id]);
  await waitFor(() => !processGroupAlive(orphanPid));
  await service.stop("alpha", kept.id);
});

test("watcherScript quotes paths and records the command's status", () => {
  const script = watcherScript("exit 3", "/tmp/it's here.log", "/tmp/it's here.exit");
  assert.match(script, /^\(exit 3\n\)/u);
  assert.match(script, />> '\/tmp\/it'\\''s here\.log' 2>&1/u);
  assert.match(script, /printf '%s\\n' "\$\?" > '\/tmp\/it'\\''s here\.exit'/u);
});

test("parseWatchers normalizes snapshot rows and drops malformed ones", () => {
  const watchers = parseWatchers([
    { id: "a", purpose: "Wait", command: "true", startedAt: "2026-10-02T10:00:00.000Z", state: "running", pid: 12, logPath: "/tmp/a.log" },
    { id: "b", purpose: "Bad state", command: "true", startedAt: "2026-10-02T10:00:00.000Z", state: "weird" },
    { id: "", purpose: "No id", command: "true", startedAt: "2026-10-02T10:00:00.000Z", state: "done" },
    "nope",
  ]);
  assert.deepEqual(watchers.map(({ id, state }) => ({ id, state })), [
    { id: "a", state: "running" },
    { id: "b", state: "dead" },
  ]);
  assert.equal(parseWatchers(undefined).length, 0);
});
