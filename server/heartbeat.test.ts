/** The gateway heartbeat: it reports a watched session to its chief, who decides; it never prompts the session. */
import assert from "node:assert/strict";
import { test } from "vitest";
import type { AutomationTask } from "./automation.ts";
import type { RouteRequest } from "./http/route.ts";
import type { SessionRecord } from "./sessions/sessions.ts";
import type { SessionGoal, SessionStatus } from "./api/sessions.ts";
import type { WatcherState } from "./api/watchers.ts";
import { createHeartbeat, LEGACY_HEARTBEAT_DESCRIPTION, removeLegacyHeartbeatRoutines } from "./heartbeat.ts";
import { createHeartbeatRoutes } from "./routes/heartbeat.ts";

const session = (id: string, updatedAt = "2026-11-11T10:00:00.000Z", extra: Partial<SessionRecord> = {}) => ({
  id, title: id, group: "", cwd: "/tmp", tool: "durable", createdAt: updatedAt, updatedAt, ...extra,
} as SessionRecord);

function fixture(targetStatus: SessionStatus = "idle", watcherStates: WatcherState[] = []) {
  const notifications: Array<{ id: string; text: string }> = [];
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
  };
  return { deps, notifications };
}

/** The route's request, with no body: `POST /__hui/heartbeat` takes none. */
function post(path = "/__hui/heartbeat"): RouteRequest {
  return {
    method: "POST", path, query: new URLSearchParams(), headers: {}, signal: new AbortController().signal,
    json: async () => ({}), bytes: async () => Buffer.alloc(0), stream: async function* () { /* no body */ },
  };
}

test("an idle watched session is reported once, and again only after a new reply", async () => {
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
  assert.equal(f.notifications.length, 1);
  // The target said something new: a new report is due.
  f.deps.lastAssistant = () => "Done. The migration ran and its tests pass.";
  assert.deepEqual(await heartbeat.scan(), { notified: ["target"] });
  assert.equal(f.notifications.length, 2);
  assert.match(f.notifications[1]?.text ?? "", /Done\. The migration ran and its tests pass\./u);
  assert.deepEqual(await heartbeat.scan(), { notified: [] });
  assert.equal(f.notifications.length, 2);
});

test("an updatedAt bump alone reports nothing, since no fact the report states changed", async () => {
  const f = fixture();
  const heartbeat = createHeartbeat(f.deps);
  assert.deepEqual(await heartbeat.scan(), { notified: ["target"] });
  f.deps.records = async () => [
    session("watcher", "2026-11-11T10:06:00.000Z", { watches: ["target"] }),
    session("target", "2026-11-11T10:06:00.000Z"),
  ];
  assert.deepEqual(await heartbeat.scan(), { notified: [] });
  assert.equal(f.notifications.length, 1);
});

test("a title edit alone reports nothing, and a stage change does", async () => {
  const f = fixture();
  const heartbeat = createHeartbeat(f.deps);
  assert.deepEqual(await heartbeat.scan(), { notified: ["target"] });
  f.deps.records = async () => [
    session("watcher", undefined, { watches: ["target"] }),
    { ...session("target"), title: "Renamed" },
  ];
  assert.deepEqual(await heartbeat.scan(), { notified: [] });
  assert.equal(f.notifications.length, 1);
  f.deps.records = async () => [
    session("watcher", undefined, { watches: ["target"] }),
    session("target", undefined, { stage: "done" }),
  ];
  assert.deepEqual(await heartbeat.scan(), { notified: ["target"] });
  assert.match(f.notifications[1]?.text ?? "", /is done; decide the next step/u);
  assert.equal(f.notifications.length, 2);
});

test("a new blocker with the same last reply is reported once per kind", async () => {
  const f = fixture();
  const heartbeat = createHeartbeat(f.deps);
  f.deps.lastAssistant = () => "The migration is ready. Should I deploy it?";
  assert.deepEqual(await heartbeat.scan(), { notified: ["target"] });
  assert.deepEqual(await heartbeat.scan(), { notified: [] });
  f.deps.status = () => "waiting";
  assert.deepEqual(await heartbeat.scan(), { notified: ["target"] });
  assert.match(f.notifications[1]?.text ?? "", /is waiting for an answer/u);
  f.deps.status = () => "error";
  assert.deepEqual(await heartbeat.scan(), { notified: ["target"] });
  assert.match(f.notifications[2]?.text ?? "", /is in error/u);
  assert.deepEqual(await heartbeat.scan(), { notified: [] });
  assert.equal(f.notifications.length, 3);
});

test("an Autonomous target's goal objective is a fact, while its note and continuations are not", async () => {
  const goal = (extra: Partial<SessionGoal> = {}): SessionGoal => ({
    objective: "Land the heartbeat fix", status: "active",
    createdAt: "2026-11-11T10:00:00.000Z", updatedAt: "2026-11-11T10:00:00.000Z", continuations: 0, ...extra,
  });
  const target = (itsGoal: SessionGoal): SessionRecord =>
    session("target", undefined, { autonomous: true, stage: "implementation", goal: itsGoal });
  const f = fixture();
  f.deps.records = async () => [session("watcher", undefined, { watches: ["target"] }), target(goal())];
  const heartbeat = createHeartbeat(f.deps);
  assert.deepEqual(await heartbeat.scan(), { notified: ["target"] });
  assert.match(f.notifications[0]?.text ?? "", /Autonomous session "target" is idle/u);
  // The goal's note and its continuation count are not facts the report depends on.
  f.deps.records = async () => [session("watcher", undefined, { watches: ["target"] }), target(goal({ note: "paused for review", continuations: 3 }))];
  assert.deepEqual(await heartbeat.scan(), { notified: [] });
  assert.equal(f.notifications.length, 1);
  // Its objective is: a second report is due, and its text is the same one, since a report never states the goal.
  f.deps.records = async () => [
    session("watcher", undefined, { watches: ["target"] }),
    target(goal({ objective: "Land the heartbeat fix and its docs", note: "paused for review", continuations: 3 })),
  ];
  assert.deepEqual(await heartbeat.scan(), { notified: ["target"] });
  assert.equal(f.notifications.length, 2);
  assert.equal(f.notifications[1]?.text, f.notifications[0]?.text);
  assert.deepEqual(await heartbeat.scan(), { notified: [] });
});

test("a restart reports a live watched session once more, because the fingerprints are in memory", async () => {
  const f = fixture();
  const heartbeat = createHeartbeat(f.deps);
  assert.deepEqual(await heartbeat.scan(), { notified: ["target"] });
  assert.deepEqual(await heartbeat.scan(), { notified: [] });
  const restarted = createHeartbeat(f.deps);
  assert.deepEqual(await restarted.scan(), { notified: ["target"] });
  assert.deepEqual(await restarted.scan(), { notified: [] });
  assert.equal(f.notifications.length, 2);
});

test("each watcher is told once, and one added later is told once while the others are not", async () => {
  const f = fixture();
  let records: SessionRecord[] = [
    session("watcher", undefined, { watches: ["target"] }),
    session("other", undefined, { watches: ["target"] }),
    session("target"),
  ];
  f.deps.records = async () => records;
  const heartbeat = createHeartbeat(f.deps);
  assert.deepEqual(await heartbeat.scan(), { notified: ["target"] });
  assert.deepEqual(f.notifications.map((notification) => notification.id), ["watcher", "other"]);
  assert.deepEqual(await heartbeat.scan(), { notified: [] });
  records = [...records, session("third", undefined, { watches: ["target"] })];
  assert.deepEqual(await heartbeat.scan(), { notified: ["target"] });
  assert.deepEqual(f.notifications.map((notification) => notification.id), ["watcher", "other", "third"]);
  assert.deepEqual(await heartbeat.scan(), { notified: [] });
  assert.equal(f.notifications.length, 3);
});

test("a watch removed for a scan and added again reports once more, and one left on an archived target is kept", async () => {
  const f = fixture();
  let records: SessionRecord[] = [session("watcher", undefined, { watches: ["target"] }), session("target")];
  f.deps.records = async () => records;
  const heartbeat = createHeartbeat(f.deps);
  assert.deepEqual(await heartbeat.scan(), { notified: ["target"] });
  records = [session("watcher"), session("target")];
  assert.deepEqual(await heartbeat.scan(), { notified: [] });
  records = [session("watcher", undefined, { watches: ["target"] }), session("target")];
  assert.deepEqual(await heartbeat.scan(), { notified: ["target"] });
  assert.equal(f.notifications.length, 2);
  // The watch stayed on, so its facts are remembered through the archive and report nothing when it comes back.
  records = [session("watcher", undefined, { watches: ["target"] }), session("target", undefined, { archived: true })];
  assert.deepEqual(await heartbeat.scan(), { notified: [] });
  records = [session("watcher", undefined, { watches: ["target"] }), session("target")];
  assert.deepEqual(await heartbeat.scan(), { notified: [] });
  assert.equal(f.notifications.length, 2);
});

test("a watcher whose delivery failed is told again, and one that already got the report is not", async () => {
  const f = fixture();
  const records = [
    session("watcher", undefined, { watches: ["target"] }),
    session("other", undefined, { watches: ["target"] }),
    session("target"),
  ];
  f.deps.records = async () => records;
  let failing = true;
  f.deps.notify = async (id, text) => {
    if (id === "watcher" && failing) throw new Error("that chat is busy");
    f.notifications.push({ id, text });
  };
  const heartbeat = createHeartbeat(f.deps);
  assert.deepEqual(await heartbeat.scan(), { notified: ["target"] });
  assert.deepEqual(f.notifications.map((notification) => notification.id), ["other"]);
  failing = false;
  assert.deepEqual(await heartbeat.scan(), { notified: ["target"] });
  assert.deepEqual(f.notifications.map((notification) => notification.id), ["other", "watcher"]);
  assert.deepEqual(await heartbeat.scan(), { notified: [] });
  assert.equal(f.notifications.length, 2);
});

test("the heartbeat route reports a POST once, not again until its facts change", async () => {
  const f = fixture();
  const route = createHeartbeatRoutes({ heartbeat: createHeartbeat(f.deps) });
  assert.deepEqual(await route(post()), { status: 200, body: { notified: ["target"] } });
  assert.deepEqual(await route(post()), { status: 200, body: { notified: [] } });
  f.deps.lastAssistant = () => "Merged and deployed. All checks green.";
  assert.deepEqual(await route(post()), { status: 200, body: { notified: ["target"] } });
  assert.deepEqual(await route(post()), { status: 200, body: { notified: [] } });
  assert.equal(f.notifications.length, 2);
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

test("an Autonomous session's stop is reported as one, its blocker as a decision", async () => {
  const f = fixture();
  f.deps.records = async () => [
    session("watcher", undefined, { watches: ["target"] }),
    session("target", undefined, { autonomous: true, lead: true }),
  ];
  f.deps.lastAssistant = () => "## Plan\nShipped the toggle in one PR; checks pass.\n\nThe deploy needs a token I do not have. Can you add it?";
  assert.deepEqual(await createHeartbeat(f.deps).scan(), { notified: ["target"] });
  assert.match(f.notifications[0]?.text ?? "", /^\[routine: Heartbeat\] Autonomous session "target" is idle and waiting for a decision\./u);
  assert.match(f.notifications[0]?.text ?? "", /Can you add it\?/u);
  assert.match(f.notifications[0]?.text ?? "", /It runs Autonomous and reports to you: approve or correct its plan, clear its blocker or settle its report/u);
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
  f.deps.lastAssistant = () => `## Report\n${"A unit of work.\n".repeat(120)}\nThe pull request is ready for review.`;
  assert.deepEqual(await createHeartbeat(f.deps).scan(), { notified: ["target"] });
  assert.match(f.notifications[0]?.text ?? "", /is idle; decide the next step\..*## Report.*….*ready for review/su);
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
  let records = [session("seeded-chat"), session("payments-chat"), session("target", undefined, { group: "Payments", autonomous: true, lead: true })];
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
  f.deps.records = async () => [session("seeded-chat", undefined, { watches: full }), session("target", undefined, { autonomous: true, lead: true })];
  f.deps.bots = async () => [{ title: "Chief of Staff", sessionId: "seeded-chat" }];
  let watches = 0;
  f.deps.watch = async () => { watches += 1; };
  f.deps.watchLimit = 2;
  assert.equal(await createHeartbeat(f.deps).supervise("target"), false);
  assert.equal(watches, 0);
  assert.equal(f.notifications.length, 0);
});

test("Supervised takes back only the watch an Autonomous stop gave, even when it comes right after that stop", async () => {
  const f = fixture();
  let records = [session("seeded-chat"), session("target", undefined, { autonomous: true, lead: true })];
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
  records = [session("seeded-chat", undefined, { watches: ["target"] }), session("target", undefined, { autonomous: true, lead: true })];
  await heartbeat.supervise("target");
  await heartbeat.release("target");
  assert.deepEqual(changes, [], "a chief's own watch stays");

  records = [session("seeded-chat"), session("target", undefined, { lead: true })];
  assert.equal(await heartbeat.supervise("target"), true);
  assert.deepEqual(changes, [], "a session no longer Autonomous gets no chief");

  changes.length = 0;
  records = [session("seeded-chat"), session("target", undefined, { autonomous: true })];
  assert.equal(await heartbeat.supervise("target"), true);
  assert.deepEqual(changes, [], "a session the operator started reports in its own chat");
});

test("a Supervised switch whose registry write fails is tried again by the next one", async () => {
  const f = fixture();
  let records = [session("seeded-chat"), session("target", undefined, { autonomous: true, lead: true })];
  let failing = false;
  const unwatched: string[] = [];
  f.deps.records = async () => records;
  f.deps.bots = async () => [{ title: "Chief of Staff", sessionId: "seeded-chat" }];
  f.deps.watch = async (watcherId, id, on) => {
    if (!on && failing) throw new Error("registry is read-only");
    if (!on) unwatched.push(watcherId);
    records = records.map((record) => record.id === watcherId ? { ...record, watches: on ? [id] : [] } : record);
  };
  const heartbeat = createHeartbeat(f.deps);
  await heartbeat.supervise("target");
  failing = true;
  await assert.rejects(heartbeat.release("target"), /read-only/u);
  failing = false;
  await heartbeat.release("target");
  assert.deepEqual(unwatched, ["seeded-chat"]);
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
