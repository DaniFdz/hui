import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";
import type { ProgressCard } from "../api/sessions.ts";
import { DEFAULT_SETTINGS } from "../hui-settings.ts";
import type { TranscriptEntry } from "../runtimes/types.ts";
import { waitFor } from "../test-support/wait-for.ts";
import { SessionProgress, SessionProgressBusyError, type SessionProgressDeps } from "./session-progress.ts";

const transcript: TranscriptEntry[] = [{ kind: "message", role: "user", text: "Fix the test" }];
const answer = "Summary: Fixed it.\nPlan:\n- done: Fix the test";
const card: ProgressCard = { markdown: "Fixed it.", steps: [{ step: "Fix the test", status: "completed" }] };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fixture(overrides: Partial<SessionProgressDeps> = {}) {
  const saved: { id: string; card: ProgressCard }[] = [];
  const progress = new SessionProgress({
    settings: async () => ({ ...DEFAULT_SETTINGS, models: { ...DEFAULT_SETTINGS.models, utility: "test/model" } }),
    session: async () => ({ cwd: "/tmp" }),
    transcript: () => transcript,
    running: () => [],
    save: async (id, card) => { saved.push({ id, card }); },
    run: async () => answer,
    ...overrides,
  });
  return { progress, saved };
}
afterEach(() => vi.useRealTimers());

test("a manual refresh awaits the transcript, generation and saved card, refusing duplicates throughout", async () => {
  const read = deferred<readonly TranscriptEntry[]>();
  const generated = deferred<string>();
  const saving = deferred<void>();
  const saveStarted = deferred<void>();
  const { progress, saved } = fixture({
    run: () => generated.promise,
    save: async () => { saveStarted.resolve(); await saving.promise; },
  });
  let completed = false;
  const refresh = progress.refresh("a", () => read.promise).then(() => { completed = true; });
  await assert.rejects(progress.refresh("a"), SessionProgressBusyError);
  read.resolve(transcript);
  generated.resolve(answer);
  await saveStarted.promise;
  assert.equal(completed, false, "success must wait for persistence");
  await assert.rejects(progress.refresh("a"), SessionProgressBusyError);
  saving.resolve();
  await refresh;
  assert.equal(completed, true);
  assert.deepEqual(saved, []);
});

test("scheduled running and queued refreshes both refuse a manual duplicate", async () => {
  const generation = deferred<string>();
  const { progress, saved } = fixture({ run: () => generation.promise });
  progress.settled("a", transcript);
  progress.settled("b", transcript);
  await assert.rejects(progress.refresh("a"), SessionProgressBusyError);
  await assert.rejects(progress.refresh("b"), SessionProgressBusyError);
  generation.resolve(answer);
  await waitFor("both scheduled cards saved", () => saved.length === 2, { state: () => saved });
  assert.deepEqual(saved.map(({ id }) => id), ["a", "b"]);
  await progress.refresh("a");
  assert.equal(saved.length, 3, "busy clears after the refresh");
});

test("a queued manual refresh keeps its completion when a settled turn arrives", async () => {
  const generation = deferred<string>();
  const { progress, saved } = fixture({ run: () => generation.promise });
  progress.settled("a", transcript);
  const manual = progress.refresh("b");
  progress.settled("b", transcript);
  await assert.rejects(progress.refresh("b"), SessionProgressBusyError);
  generation.resolve(answer);
  await manual;
  assert.deepEqual(saved, [{ id: "a", card }, { id: "b", card }]);
});

test("a timer refresh reserves its card just like a settled turn", async () => {
  vi.useFakeTimers();
  const generation = deferred<string>();
  const { progress } = fixture({ running: () => ["a", "b"], intervalMs: 100, run: () => generation.promise });
  progress.start();
  await vi.advanceTimersByTimeAsync(100);
  await assert.rejects(progress.refresh("a"), SessionProgressBusyError);
  await assert.rejects(progress.refresh("b"), SessionProgressBusyError);
  generation.resolve(answer);
  await vi.advanceTimersByTimeAsync(0);
  vi.clearAllTimers();
});

test("generation failures reject manual refreshes without overwriting the last card, and allow a retry", async () => {
  let fail = true;
  let stored: ProgressCard = { markdown: "Old card", steps: [] };
  const { progress } = fixture({
    run: async () => { if (fail) throw new Error("provider unavailable"); return answer; },
    save: async (_id, card) => { stored = card; },
  });
  await assert.rejects(progress.refresh("a"), /provider unavailable/u);
  assert.deepEqual(stored, { markdown: "Old card", steps: [] });
  fail = false;
  await progress.refresh("a");
  assert.deepEqual(stored, card);
});

test("an unusable answer, unavailable utility model, transcript failure or save failure never reports success", async () => {
  const cases: Partial<SessionProgressDeps>[] = [
    { run: async () => "not a progress card" },
    { settings: async () => DEFAULT_SETTINGS },
    { save: async () => { throw new Error("registry unavailable"); } },
  ];
  for (const overrides of cases) {
    const { progress, saved } = fixture(overrides);
    await assert.rejects(progress.refresh("a"));
    assert.deepEqual(saved, []);
  }
  const { progress, saved } = fixture();
  await assert.rejects(progress.refresh("a", async () => { throw new Error("transcript unavailable"); }), /transcript unavailable/u);
  assert.deepEqual(saved, []);
  await progress.refresh("a");
  assert.deepEqual(saved, [{ id: "a", card }]);
});
