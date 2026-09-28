import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  AutomationInputError,
  AutomationService,
  AutomationStoreError,
  nextCronAt,
  normalizeSchedule,
  parseCron,
} from "./automation.ts";

const future = "2030-01-02T12:00:00.000Z";

async function temporaryFile(): Promise<string> {
  return join(await mkdtemp(join(tmpdir(), "hui-automation-")), "automation.json");
}

async function waitFor(
  check: () => Promise<boolean>,
  attempts = 50,
): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await check()) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  assert.fail("observable automation state did not arrive");
}

test("validates cron fields and finds the next zoned occurrence", () => {
  assert.deepEqual([...parseCron("15 9 * * 1-5").minute], [15]);
  assert.equal(
    new Date(nextCronAt("0 9 * * 1-5", "Europe/Madrid", Date.parse("2026-09-18T12:00:00Z"))).toISOString(),
    "2026-09-21T07:00:00.000Z",
  );
  assert.throws(() => parseCron("0 25 * * *"), AutomationInputError);
  assert.throws(() => normalizeSchedule({ kind: "every", everyMs: 59_999 }), AutomationInputError);
  assert.throws(() => normalizeSchedule({ kind: "cron", expression: "0 9 * * *", timezone: "Mars/Olympus" }), AutomationInputError);
});

test("persists task definitions atomically and reloads them", async () => {
  const file = await temporaryFile();
  const first = new AutomationService(file, async () => ({}));
  const created = await first.create({
    name: "Daily review",
    description: "Review the current workspace",
    sessionId: "session-1",
    prompt: "Review open work.",
    schedule: { kind: "at", at: future },
    enabled: true,
    timeoutSeconds: 120,
  });
  assert.equal(created.nextRunAt, future);
  first.dispose();

  const second = new AutomationService(file, async () => ({}));
  const snapshot = await second.snapshot();
  assert.equal(snapshot.tasks.length, 1);
  assert.equal(snapshot.tasks[0]?.name, "Daily review");
  assert.equal(snapshot.runs.length, 0);
  second.dispose();

  const stored = JSON.parse(await readFile(file, "utf8")) as { version: number };
  assert.equal(stored.version, 1);
});

test("records manual run lifecycle and summary", async () => {
  const file = await temporaryFile();
  let release!: () => void;
  const started = new Promise<void>((resolveStarted) => {
    release = resolveStarted;
  });
  let entered!: () => void;
  const executorEntered = new Promise<void>((resolve) => { entered = resolve; });
  const service = new AutomationService(file, async () => {
    entered();
    await started;
    return { summary: "Done" };
  });
  const task = await service.create({
    name: "Review",
    sessionId: "session-1",
    prompt: "Review this.",
    schedule: { kind: "at", at: future },
  });
  const queued = await service.run(task.id);
  assert.equal(queued.status, "queued");
  await executorEntered;
  assert.equal((await service.snapshot()).runs[0]?.status, "running");
  release();
  await waitFor(async () => (await service.snapshot()).runs[0]?.status === "completed");
  const completed = (await service.snapshot()).runs[0];
  assert.equal(completed?.summary, "Done");
  assert.ok(completed?.finishedAt);
  service.dispose();
});

test("cancels only an active run and records cancellation", async () => {
  const file = await temporaryFile();
  let entered!: () => void;
  const executorEntered = new Promise<void>((resolve) => { entered = resolve; });
  const service = new AutomationService(file, async (_task, signal) => {
    entered();
    await new Promise<void>((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new DOMException("cancelled", "AbortError")), { once: true });
    });
    return {};
  });
  const task = await service.create({
    name: "Long task",
    sessionId: "session-1",
    prompt: "Wait.",
    schedule: { kind: "at", at: future },
  });
  const run = await service.run(task.id);
  await executorEntered;
  await service.cancel(run.id);
  await waitFor(async () => (await service.snapshot()).runs[0]?.status === "cancelled");
  await assert.rejects(() => service.cancel(run.id));
  service.dispose();
});

test("corrupt automation data is reported and never replaced", async () => {
  const file = await temporaryFile();
  await writeFile(file, "{broken", "utf8");
  const service = new AutomationService(file, async () => ({}));
  await assert.rejects(() => service.snapshot(), AutomationStoreError);
  assert.equal(await readFile(file, "utf8"), "{broken");
  service.dispose();
});
