/** The gateway heartbeat: it reports a watched session to its chief, who decides; it never prompts the session. */
import assert from "node:assert/strict";
import { test } from "vitest";
import type { AutomationTask } from "./automation.ts";
import type { SessionRecord } from "./sessions/sessions.ts";
import type { SessionStatus } from "./api/sessions.ts";
import type { WatcherState } from "./api/watchers.ts";
import { createHeartbeat, LEGACY_HEARTBEAT_DESCRIPTION, removeLegacyHeartbeatRoutines } from "./heartbeat.ts";

const session = (id: string, updatedAt = "2026-11-11T10:00:00.000Z", extra: Partial<SessionRecord> = {}) => ({
  id, title: id, group: "", cwd: "/tmp", tool: "durable", createdAt: updatedAt, updatedAt, ...extra,
} as SessionRecord);

function fixture(targetStatus: SessionStatus = "idle", watcherStates: WatcherState[] = []) {
  const notifications: Array<{ id: string; text: string }> = [];
  let now = Date.parse("2026-11-11T10:05:00.000Z");
  const deps = {
    records: async () => [
      session("watcher", undefined, { watches: ["target"] }),
      session("target"),
    ],
    status: () => targetStatus,
    watchers: () => watcherStates.map((state) => ({ state })),
    subagents: (): readonly { status: string }[] => [],
    lastAssistant: () => "Done.",
    notify: async (id: string, text: string) => { notifications.push({ id, text }); },
    now: () => now,
  };
  return { deps, notifications };
}

test("an idle watched session is reported once, and again only after it changes", async () => {
  const f = fixture();
  const heartbeat = createHeartbeat(f.deps);
  assert.deepEqual(await heartbeat.scan(), { notified: ["target"] });
  assert.equal(f.notifications.length, 1);
  assert.equal(f.notifications[0]?.id, "watcher");
  assert.match(f.notifications[0]?.text ?? "", /is idle; decide the next step/u);
  assert.match(f.notifications[0]?.text ?? "", /\| Session \| Pull request \| Status \/ blockers \|/u);
  assert.match(f.notifications[0]?.text ?? "", /\[target\]\(\/sessions\/target\?open=app\)/u);
  assert.match(f.notifications[0]?.text ?? "", /Send one specific followup/u);
  assert.match(f.notifications[0]?.text ?? "", /Do not send a generic continue/u);
  assert.doesNotMatch(f.notifications[0]?.text ?? "", /Autonomous/u);
  assert.deepEqual(await heartbeat.scan(), { notified: [] });
  // The target changed: a new idle span is due.
  f.deps.records = async () => [
    session("watcher", undefined, { watches: ["target"] }),
    session("target", "2026-11-11T10:06:00.000Z"),
  ];
  assert.deepEqual(await heartbeat.scan(), { notified: ["target"] });
});

test("an idle decision is reported with the decision status", async () => {
  const f = fixture();
  f.deps.lastAssistant = () => "The migration is ready. Should I deploy it?";
  const heartbeat = createHeartbeat(f.deps);
  assert.deepEqual(await heartbeat.scan(), { notified: ["target"] });
  assert.equal(f.notifications.length, 1);
  assert.match(f.notifications[0]?.text ?? "", /^\[routine: Heartbeat\] Watched session "target" is idle and waiting for a decision\./u);
  assert.match(f.notifications[0]?.text ?? "", /\| \[target\]\(\/sessions\/target\?open=app\) \| — \| Waiting on you: a decision \|/u);
  assert.match(f.notifications[0]?.text ?? "", /Should I deploy it\?/u);
  assert.deepEqual(await heartbeat.scan(), { notified: [] });
  assert.equal(f.notifications.length, 1);
});

test("waiting and error states tell the watcher and never prompt the target", async () => {
  for (const status of ["waiting", "error"] as const) {
    const f = fixture(status);
    assert.deepEqual(await createHeartbeat(f.deps).scan(), { notified: ["target"] });
    assert.equal(f.notifications.length, 1);
    assert.match(f.notifications[0]?.text ?? "", new RegExp(status === "error" ? "is in error" : "is waiting for an answer", "u"));
    assert.match(f.notifications[0]?.text ?? "", new RegExp(status === "error" ? "Blocked: error" : "Waiting on you: an answer", "u"));
  }
});

test("a done-stage target tells the watcher once and is never continued", async () => {
  const f = fixture();
  f.deps.records = async () => [
    session("watcher", undefined, { watches: ["target"] }),
    session("target", undefined, { stage: "done" }),
  ];
  f.deps.lastAssistant = () => "Merged and deployed. All checks green.";
  const heartbeat = createHeartbeat(f.deps);
  assert.deepEqual(await heartbeat.scan(), { notified: ["target"] });
  assert.equal(f.notifications.length, 1);
  assert.match(f.notifications[0]?.text ?? "", /is done; decide the next step/u);
  assert.match(f.notifications[0]?.text ?? "", /\| \[target\]\(\/sessions\/target\?open=app\) \| — \| Done \|/u);
  assert.match(f.notifications[0]?.text ?? "", /remove the watch/u);
  assert.deepEqual(await heartbeat.scan(), { notified: [] });
  assert.equal(f.notifications.length, 1);
});

test("an Autonomous session's stop is reported as one, its plan as a decision", async () => {
  const f = fixture();
  f.deps.records = async () => [
    session("watcher", undefined, { watches: ["target"] }),
    session("target", undefined, { autonomous: true }),
  ];
  f.deps.lastAssistant = () => "## Plan\nShip the toggle in one PR.\n\nAccept this plan?";
  assert.deepEqual(await createHeartbeat(f.deps).scan(), { notified: ["target"] });
  assert.match(f.notifications[0]?.text ?? "", /^\[routine: Heartbeat\] Autonomous session "target" is idle and waiting for a decision\./u);
  assert.match(f.notifications[0]?.text ?? "", /Accept this plan\?/u);
  assert.match(f.notifications[0]?.text ?? "", /It runs in Autonomous mode and reports to you: accept or correct its plan/u);
});

test("an idle session whose subagents still work waits for them, and is reported once they finish", async () => {
  const f = fixture();
  let children = [{ status: "running" }, { status: "completed" }];
  f.deps.subagents = () => children;
  const heartbeat = createHeartbeat(f.deps);
  assert.deepEqual(await heartbeat.scan(), { notified: [] });
  children = [{ status: "queued" }];
  assert.deepEqual(await heartbeat.scan(), { notified: [] });
  children = [{ status: "completed" }];
  assert.deepEqual(await heartbeat.scan(), { notified: ["target"] });
});

test("scans asked for at once run one after the other and report a change once", async () => {
  const f = fixture();
  f.deps.notify = async (id, text) => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    f.notifications.push({ id, text });
  };
  const heartbeat = createHeartbeat(f.deps);
  const [first, second] = await Promise.all([heartbeat.scan(), heartbeat.scan()]);
  assert.deepEqual([first, second], [{ notified: ["target"] }, { notified: [] }]);
  assert.equal(f.notifications.length, 1);
});

test("running, starting, reconnecting and disconnected targets are left alone", async () => {
  for (const status of ["running", "starting", "reconnecting", "disconnected"] as const) {
    const f = fixture(status);
    assert.deepEqual(await createHeartbeat(f.deps).scan(), { notified: [] }, status);
    assert.equal(f.notifications.length, 0);
  }
  const watched = fixture("idle", ["running"]);
  assert.deepEqual(await createHeartbeat(watched.deps).scan(), { notified: [] });
  assert.equal(watched.notifications.length, 0);
});

test("a paused goal, an archived target, a bot chat and an archived watcher are skipped", async () => {
  const cases = [
    [session("watcher", undefined, { watches: ["target"] }), session("target", undefined, { goal: { objective: "x", status: "paused", createdAt: "", updatedAt: "", continuations: 0 } })],
    [session("watcher", undefined, { watches: ["target"] }), session("target", undefined, { archived: true })],
    [session("watcher", undefined, { watches: ["target"] }), session("target", undefined, { bot: "bot-1" })],
    [session("watcher", undefined, { watches: ["target"], archived: true }), session("target")],
  ];
  for (const records of cases) {
    const notifications: string[] = [];
    const heartbeat = createHeartbeat({
      records: async () => records, status: () => "idle", watchers: () => [], subagents: () => [],
      lastAssistant: () => "Done.", notify: async (id) => { notifications.push(id); },
    });
    assert.deepEqual(await heartbeat.scan(), { notified: [] });
    assert.deepEqual(notifications, []);
  }
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
