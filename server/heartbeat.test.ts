/** The gateway heartbeat: an idle watched session is continued at most once per idle span, without a bot turn. */
import assert from "node:assert/strict";
import { test } from "vitest";
import type { AutomationTask } from "./automation.ts";
import type { SessionRecord } from "./sessions/sessions.ts";
import type { SessionStatus } from "./api/sessions.ts";
import type { WatcherState } from "./api/watchers.ts";
import { createHeartbeat, HEARTBEAT_PROMPT, LEGACY_HEARTBEAT_DESCRIPTION, removeLegacyHeartbeatRoutines } from "./heartbeat.ts";

const session = (id: string, updatedAt = "2026-11-11T10:00:00.000Z", extra: Partial<SessionRecord> = {}) => ({
  id, title: id, group: "", cwd: "/tmp", tool: "durable", createdAt: updatedAt, updatedAt, ...extra,
} as SessionRecord);

function fixture(targetStatus: SessionStatus = "idle", watcherStates: WatcherState[] = []) {
  const prompts: Array<{ id: string; text: string }> = [];
  let now = Date.parse("2026-11-11T10:05:00.000Z");
  const deps = {
    records: async () => [
      session("watcher", undefined, { watches: ["target"] }),
      session("target"),
    ],
    status: () => targetStatus,
    watchers: () => watcherStates.map((state) => ({ state })),
    prompt: async (id: string, text: string) => { prompts.push({ id, text }); },
    now: () => now,
  };
  return { deps, prompts, advance: (ms: number) => { now += ms; } };
}

test("an idle watched session is continued once, and again only after it changes", async () => {
  const f = fixture();
  const heartbeat = createHeartbeat(f.deps);
  assert.deepEqual(await heartbeat.scan(), { continued: ["target"] });
  assert.deepEqual(f.prompts, [{ id: "target", text: HEARTBEAT_PROMPT }]);
  assert.deepEqual(await heartbeat.scan(), { continued: [] });
  // The target's transcript/record moved: a new idle span is due.
  f.deps.records = async () => [
    session("watcher", undefined, { watches: ["target"] }),
    session("target", "2026-11-11T10:06:00.000Z"),
  ];
  assert.deepEqual(await heartbeat.scan(), { continued: ["target"] });
});

test("a running target or a running watcher is left alone", async () => {
  const running = fixture("running");
  assert.deepEqual(await createHeartbeat(running.deps).scan(), { continued: [] });
  const watched = fixture("idle", ["running"]);
  assert.deepEqual(await createHeartbeat(watched.deps).scan(), { continued: [] });
});

test("a paused goal, an archived target, a bot chat and an archived watcher are skipped", async () => {
  const cases = [
    [session("watcher", undefined, { watches: ["target"] }), session("target", undefined, { goal: { objective: "x", status: "paused", createdAt: "", updatedAt: "", continuations: 0 } })],
    [session("watcher", undefined, { watches: ["target"] }), session("target", undefined, { archived: true })],
    [session("watcher", undefined, { watches: ["target"] }), session("target", undefined, { bot: "bot-1" })],
    [session("watcher", undefined, { watches: ["target"], archived: true }), session("target")],
  ];
  for (const records of cases) {
    const prompts: string[] = [];
    const heartbeat = createHeartbeat({
      records: async () => records, status: () => "idle", watchers: () => [], prompt: async (id) => { prompts.push(id); },
    });
    assert.deepEqual(await heartbeat.scan(), { continued: [] });
    assert.deepEqual(prompts, []);
  }
});

test("a stopped prompt is retried on the next scan", async () => {
  let attempts = 0;
  const heartbeat = createHeartbeat({
    records: async () => [session("watcher", undefined, { watches: ["target"] }), session("target")],
    status: () => "idle",
    watchers: () => [],
    prompt: async () => { attempts += 1; if (attempts === 1) throw new Error("busy"); },
  });
  assert.deepEqual(await heartbeat.scan(), { continued: [] });
  assert.deepEqual(await heartbeat.scan(), { continued: ["target"] });
});

test("only the routines the previous build provisioned are removed", async () => {
  const removed: string[] = [];
  const tasks = [
    { id: "old", name: "Heartbeat", description: LEGACY_HEARTBEAT_DESCRIPTION },
    { id: "operator", name: "Heartbeat", description: "My own check." },
    { id: "other", name: "Watch", description: LEGACY_HEARTBEAT_DESCRIPTION },
  ] as AutomationTask[];
  assert.deepEqual(await removeLegacyHeartbeatRoutines({
    snapshot: async () => ({ tasks } as never),
    remove: async (id) => { removed.push(id); },
  }), ["old"]);
  assert.deepEqual(removed, ["old"]);
});
