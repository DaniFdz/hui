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
  const notifications: Array<{ id: string; text: string }> = [];
  let now = Date.parse("2026-11-11T10:05:00.000Z");
  const deps = {
    records: async () => [
      session("watcher", undefined, { watches: ["target"] }),
      session("target"),
    ],
    status: () => targetStatus,
    watchers: () => watcherStates.map((state) => ({ state })),
    prompt: async (id: string, text: string) => { prompts.push({ id, text }); },
    lastAssistant: () => "Done.",
    notify: async (id: string, text: string) => { notifications.push({ id, text }); },
    now: () => now,
  };
  return { deps, prompts, notifications, advance: (ms: number) => { now += ms; } };
}

test("an idle watched session is continued once, and again only after it changes", async () => {
  const f = fixture();
  const heartbeat = createHeartbeat(f.deps);
  assert.deepEqual(await heartbeat.scan(), { continued: ["target"] });
  assert.deepEqual(f.prompts, [{ id: "target", text: HEARTBEAT_PROMPT }]);
  assert.equal(f.notifications.length, 1);
  assert.match(f.notifications[0]?.text ?? "", /\| Session \| Pull request \| Status \/ blockers \|/u);
  assert.match(f.notifications[0]?.text ?? "", /\[target\]\(\/sessions\/target\?open=app\)/u);
  assert.match(f.notifications[0]?.text ?? "", /Report this status to the operator/u);
  assert.deepEqual(await heartbeat.scan(), { continued: [] });
  // The target's transcript/record moved: a new idle span is due.
  f.deps.records = async () => [
    session("watcher", undefined, { watches: ["target"] }),
    session("target", "2026-11-11T10:06:00.000Z"),
  ];
  assert.deepEqual(await heartbeat.scan(), { continued: ["target"] });
});

test("an idle decision is sent to the watcher instead of a continuation", async () => {
  const f = fixture();
  f.deps.lastAssistant = () => "The migration is ready. Should I deploy it?";
  const heartbeat = createHeartbeat(f.deps);
  assert.deepEqual(await heartbeat.scan(), { continued: [] });
  assert.deepEqual(f.prompts, []);
  assert.equal(f.notifications.length, 1);
  assert.equal(f.notifications[0]?.id, "watcher");
  assert.match(f.notifications[0]?.text ?? "", /^\[routine: Heartbeat\] Watched session "target" is idle and waiting for a decision\./u);
  assert.match(f.notifications[0]?.text ?? "", /\| \[target\]\(\/sessions\/target\?open=app\) \| — \| Waiting on you: a decision \|/u);
  assert.match(f.notifications[0]?.text ?? "", /Should I deploy it\?/u);
  // The target did not change: one status, not one every scan.
  assert.deepEqual(await heartbeat.scan(), { continued: [] });
  assert.equal(f.notifications.length, 1);
  f.deps.records = async () => [session("watcher", undefined, { watches: ["target"] }), session("target", "2026-11-11T10:06:00.000Z")];
  assert.deepEqual(await heartbeat.scan(), { continued: [] });
  assert.equal(f.notifications.length, 2);
});

test("waiting and error states tell the watcher, and never prompt the target", async () => {
  for (const status of ["waiting", "error"] as const) {
    const f = fixture(status);
    assert.deepEqual(await createHeartbeat(f.deps).scan(), { continued: [] });
    assert.deepEqual(f.prompts, []);
    assert.equal(f.notifications.length, 1);
    assert.match(f.notifications[0]?.text ?? "", new RegExp(status === "error" ? "is in error" : "is waiting for an answer", "u"));
  }
});

test("waiting for input, an error, a starting runtime and a done stage are never continued", async () => {
  for (const status of ["waiting", "error", "starting", "reconnecting", "disconnected"] as const) {
    const f = fixture(status);
    assert.deepEqual(await createHeartbeat(f.deps).scan(), { continued: [] }, status);
  }
  const done = fixture();
  done.deps.records = async () => [
    session("watcher", undefined, { watches: ["target"] }),
    session("target", undefined, { stage: "done" }),
  ];
  assert.deepEqual(await createHeartbeat(done.deps).scan(), { continued: [] });
});

test("a done-stage target tells the watcher once and is never continued", async () => {
  const f = fixture();
  f.deps.records = async () => [
    session("watcher", undefined, { watches: ["target"] }),
    session("target", undefined, { stage: "done" }),
  ];
  f.deps.lastAssistant = () => "Merged and deployed. All checks green.";
  const heartbeat = createHeartbeat(f.deps);
  assert.deepEqual(await heartbeat.scan(), { continued: [] });
  assert.deepEqual(f.prompts, []);
  assert.equal(f.notifications.length, 1);
  assert.match(f.notifications[0]?.text ?? "", /reached done/u);
  assert.match(f.notifications[0]?.text ?? "", /\| \[target\]\(\/sessions\/target\?open=app\) \| — \| Done \|/u);
  assert.deepEqual(await heartbeat.scan(), { continued: [] });
  assert.equal(f.notifications.length, 1);
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
      lastAssistant: () => "Done.", notify: async () => {},
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
    lastAssistant: () => "Done.",
    notify: async () => {},
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
