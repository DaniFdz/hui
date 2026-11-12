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
    isLive: () => true,
    watchers: () => watcherStates.map((state) => ({ state })),
    subagents: (): readonly { status: string }[] => [],
    lastAssistant: (): string | undefined => "Done.",
    notify: async (id: string, text: string) => { notifications.push({ id, text }); },
    bots: async (): Promise<readonly { title?: string; group?: string; archived?: boolean; sessionId: string }[]> => [],
    watch: async (_watcherId: string, _id: string, _on: boolean) => {},
    watchLimit: 50,
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
    assert.equal(/A question card in the session is answered only there/u.test(f.notifications[0]?.text ?? ""), status === "waiting");
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

test("an idle session whose subagents still work waits for them, unless it asks something", async () => {
  const f = fixture();
  let children = [{ status: "running" }, { status: "completed" }];
  f.deps.subagents = () => children;
  const heartbeat = createHeartbeat(f.deps);
  assert.deepEqual(await heartbeat.scan(), { notified: [] });
  children = [{ status: "queued" }];
  assert.deepEqual(await heartbeat.scan(), { notified: [] });
  children = [{ status: "completed" }];
  assert.deepEqual(await heartbeat.scan(), { notified: ["target"] });

  const asking = fixture();
  asking.deps.subagents = () => [{ status: "running" }];
  asking.deps.lastAssistant = () => "The worker is still running. Should the plan keep the old route?";
  assert.deepEqual(await createHeartbeat(asking.deps).scan(), { notified: ["target"] });

  const reporting = fixture();
  reporting.deps.subagents = () => [{ status: "running" }];
  reporting.deps.lastAssistant = () => "Spawned the verifier, which runs the suite; waiting for it to finish.";
  assert.deepEqual(await createHeartbeat(reporting.deps).scan(), { notified: [] });
});

test("a session not open in this gateway is not reported, so a restart reports nothing again", async () => {
  const f = fixture();
  f.deps.isLive = () => false;
  assert.deepEqual(await createHeartbeat(f.deps).scan(), { notified: [] });
  assert.equal(f.notifications.length, 0);
});

test("an Autonomous session is reported whatever its goal's status, with the end of a long plan", async () => {
  const f = fixture();
  f.deps.records = async () => [
    session("watcher", undefined, { watches: ["target"] }),
    session("target", undefined, { autonomous: true, goal: { objective: "x", status: "complete", createdAt: "", updatedAt: "", continuations: 0 } }),
  ];
  f.deps.lastAssistant = () => `## Plan\n${"A unit of work.\n".repeat(120)}\nAccept this plan?`;
  assert.deepEqual(await createHeartbeat(f.deps).scan(), { notified: ["target"] });
  assert.match(f.notifications[0]?.text ?? "", /is idle and waiting for a decision\..*## Plan.*…\n.*Accept this plan\?/su);
});

test("scans asked for at once run one after the other and report a change once", async () => {
  const f = fixture();
  let deliver!: () => void;
  const delivered = new Promise<void>((resolve) => { deliver = resolve; });
  f.deps.notify = async (id, text) => {
    await delivered;
    f.notifications.push({ id, text });
  };
  const heartbeat = createHeartbeat(f.deps);
  const scans = Promise.all([heartbeat.scan(), heartbeat.scan()]);
  deliver();
  assert.deepEqual(await scans, [{ notified: ["target"] }, { notified: [] }]);
  assert.equal(f.notifications.length, 1);
});

test("an Autonomous session that stops gets its chief as watcher, and the stop reaches that chief at once", async () => {
  const f = fixture();
  let records = [session("seeded-chat"), session("payments-chat"), session("target", undefined, { group: "Payments", autonomous: true })];
  const watched: Array<[string, string]> = [];
  f.deps.records = async () => records;
  f.deps.bots = async () => [{ title: "Chief of Staff", sessionId: "seeded-chat" }, { title: "Chief of Staff · Payments", group: "Payments", sessionId: "payments-chat" }];
  f.deps.watch = async (watcherId, id) => {
    watched.push([watcherId, id]);
    records = records.map((record) => record.id === watcherId ? { ...record, watches: [id] } : record);
  };
  const heartbeat = createHeartbeat(f.deps);
  assert.equal(await heartbeat.supervise("target"), true);
  assert.deepEqual(watched, [["payments-chat", "target"]]);
  assert.equal(f.notifications[0]?.id, "payments-chat");
  assert.match(f.notifications[0]?.text ?? "", /^\[routine: Heartbeat\] Autonomous session "target" is idle; decide the next step\./u);

  assert.equal(await heartbeat.supervise("target"), true);
  assert.deepEqual(watched, [["payments-chat", "target"]]);
});

test("a chief whose watch list is full is not given the session, and the stop reaches no one", async () => {
  const f = fixture();
  const full = Array.from({ length: 2 }, (_, index) => `other-${index}`);
  f.deps.records = async () => [session("seeded-chat", undefined, { watches: full }), session("target", undefined, { autonomous: true })];
  f.deps.bots = async () => [{ title: "Chief of Staff", sessionId: "seeded-chat" }];
  let watches = 0;
  f.deps.watch = async () => { watches += 1; };
  f.deps.watchLimit = 2;
  assert.equal(await createHeartbeat(f.deps).supervise("target"), false);
  assert.equal(watches, 0);
  assert.equal(f.notifications.length, 0);
});

test("Ask me takes back only the watch an Autonomous stop gave, even when it comes right after that stop", async () => {
  const f = fixture();
  let records = [session("seeded-chat"), session("target", undefined, { autonomous: true })];
  const changes: Array<[string, string, boolean]> = [];
  f.deps.records = async () => records;
  f.deps.bots = async () => [{ title: "Chief of Staff", sessionId: "seeded-chat" }];
  f.deps.watch = async (watcherId, id, on) => {
    changes.push([watcherId, id, on]);
    records = records.map((record) => record.id === watcherId ? { ...record, watches: on ? [id] : [] } : record);
  };
  const heartbeat = createHeartbeat(f.deps);
  await Promise.all([heartbeat.supervise("target"), heartbeat.release("target")]);
  assert.deepEqual(changes, [["seeded-chat", "target", true], ["seeded-chat", "target", false]]);

  changes.length = 0;
  records = [session("seeded-chat", undefined, { watches: ["target"] }), session("target", undefined, { autonomous: true })];
  await heartbeat.supervise("target");
  await heartbeat.release("target");
  assert.deepEqual(changes, [], "a chief's own watch stays");

  records = [session("seeded-chat"), session("target")];
  assert.equal(await heartbeat.supervise("target"), true);
  assert.deepEqual(changes, [], "a session no longer Autonomous gets no chief");
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
      records: async () => records, status: () => "idle", isLive: () => true, watchers: () => [], subagents: () => [],
      lastAssistant: () => "Done.", notify: async (id) => { notifications.push(id); },
      bots: async () => [], watch: async () => {}, watchLimit: 50,
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
