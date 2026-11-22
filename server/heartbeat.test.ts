/** The gateway heartbeat: it reports a watched session to its chief, who decides; it never prompts the session. */
import assert from "node:assert/strict";
import { test } from "vitest";
import type { AutomationTask } from "./automation.ts";
import type { RouteRequest } from "./http/route.ts";
import type { SessionRecord } from "./sessions/sessions.ts";
import type { SessionGoal, SessionStatus } from "./api/sessions.ts";
import type { WatcherState } from "./api/watchers.ts";
import { createHeartbeat, LEGACY_HEARTBEAT_DESCRIPTION, removeLegacyHeartbeatRoutines } from "./heartbeat.ts";
import { SessionBusyError } from "./sessions/live-sessions.ts";
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
    lastAssistant: (_id: string): string | undefined => "Done.",
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

/** A watcher's chat as a bot's chat behaves: a report lands while it is idle, and one arriving while it works is
 * refused with `SessionBusyError`, which is what `whenBusy: "refuse"` does for the heartbeat. A delivered report makes
 * it busy, as the turn it starts does. */
function refusingChat() {
  const state = { busy: false, delivered: [] as Array<{ id: string; text: string }> };
  const notify = async (id: string, text: string): Promise<void> => {
    if (state.busy) throw new SessionBusyError("That chat is already working on a prompt.");
    state.delivered.push({ id, text });
    state.busy = true;
  };
  return { state, notify };
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

test("a report refused by a busy chat sends nothing and is not remembered as sent", async () => {
  const f = fixture();
  const chat = refusingChat();
  f.deps.notify = chat.notify;
  chat.state.busy = true;
  const heartbeat = createHeartbeat(f.deps);
  assert.deepEqual(await heartbeat.scan(), { notified: [] }, "a refused report counts as no report");
  assert.deepEqual(chat.state.delivered, [], "nothing reached the busy chat");
  assert.equal(f.notifications.length, 0);
});

test("the next scan is the fallback: a refused pair is retried once, with the newest facts", async () => {
  const f = fixture();
  const chat = refusingChat();
  f.deps.notify = chat.notify;
  chat.state.busy = true;
  const heartbeat = createHeartbeat(f.deps);
  assert.deepEqual(await heartbeat.scan(), { notified: [] });
  // Its turn ended with no run end to flush it, so the 15-minute scan is the retry.
  chat.state.busy = false;
  f.deps.lastAssistant = () => "The retry found newer facts.";
  assert.deepEqual(await heartbeat.scan(), { notified: ["target"] });
  assert.equal(chat.state.delivered.length, 1);
  assert.match(chat.state.delivered[0]?.text ?? "", /The retry found newer facts\./u);
  assert.deepEqual(await heartbeat.scan(), { notified: [] }, "and once only");
  assert.equal(chat.state.delivered.length, 1);
});

test("a run end delivers the refused report recomputed from the newest facts", async () => {
  const f = fixture();
  f.deps.lastAssistant = () => "First reply.";
  const chat = refusingChat();
  f.deps.notify = chat.notify;
  chat.state.busy = true;
  const heartbeat = createHeartbeat(f.deps);
  assert.deepEqual(await heartbeat.scan(), { notified: [] });
  f.deps.lastAssistant = () => "Second reply: the migration ran and its tests pass.";
  chat.state.busy = false;
  await heartbeat.watcherIdle("watcher");
  assert.equal(chat.state.delivered.length, 1, "exactly one report");
  assert.match(chat.state.delivered[0]?.text ?? "", /Second reply: the migration ran and its tests pass\./u);
  assert.doesNotMatch(chat.state.delivered[0]?.text ?? "", /First reply\./u, "the old facts were never delivered");
});

test("scans while the chat is busy report nothing, and a run end sends one report", async () => {
  const f = fixture();
  const chat = refusingChat();
  f.deps.notify = chat.notify;
  chat.state.busy = true;
  const heartbeat = createHeartbeat(f.deps);
  assert.deepEqual(await heartbeat.scan(), { notified: [] });
  assert.deepEqual(await heartbeat.scan(), { notified: [] });
  assert.deepEqual(chat.state.delivered, [], "two scans sent nothing and kept no duplicate");
  chat.state.busy = false;
  await Promise.all([heartbeat.watcherIdle("watcher"), heartbeat.watcherIdle("watcher")]);
  assert.equal(chat.state.delivered.length, 1, "two flushes asked for at once send one report");
  await heartbeat.watcherIdle("watcher");
  assert.equal(chat.state.delivered.length, 1, "the pair is no longer pending");
});

test("a run end with nothing pending neither scans nor notifies", async () => {
  const f = fixture();
  let reads = 0;
  const records = f.deps.records;
  f.deps.records = async () => { reads += 1; return records(); };
  const heartbeat = createHeartbeat(f.deps);
  await heartbeat.watcherIdle("watcher");
  assert.equal(reads, 0, "a run end alone never starts a scan");
  assert.equal(f.notifications.length, 0);
  // A scan does read the registry, so the assertion above is about the guard and not a fixture that never runs.
  await heartbeat.scan();
  assert.equal(reads, 1);
  assert.equal(f.notifications.length, 1);
});

test("one report per watcher per scan: a second target waits for a later flush", async () => {
  const f = fixture();
  f.deps.records = async () => [
    session("watcher", undefined, { watches: ["first", "second"] }),
    session("first"),
    session("second"),
  ];
  const chat = refusingChat();
  f.deps.notify = chat.notify;
  const heartbeat = createHeartbeat(f.deps);
  assert.deepEqual(await heartbeat.scan(), { notified: ["first"] }, "the second waits, since the chat the first one made busy refuses it");
  assert.equal(chat.state.delivered.length, 1);
  assert.match(chat.state.delivered[0]?.text ?? "", /\[first\]\(\/sessions\/first\?open=app\)/u);
  chat.state.busy = false;
  await heartbeat.watcherIdle("watcher");
  assert.equal(chat.state.delivered.length, 2);
  assert.match(chat.state.delivered[1]?.text ?? "", /\[second\]\(\/sessions\/second\?open=app\)/u);
  chat.state.busy = false;
  await heartbeat.watcherIdle("watcher");
  assert.equal(chat.state.delivered.length, 2, "nothing is left pending");
});

test("one report per watcher per scan holds when a delivery settles at once, and the rest waits for a run end", async () => {
  const f = fixture();
  f.deps.records = async () => [
    session("watcher", undefined, { watches: ["first", "second"] }),
    session("first"),
    session("second"),
  ];
  // The fixture's delivery starts no turn, so the chat is idle again the moment `notify` resolves: what the scan holds
  // back cannot lean on the chat still being busy afterwards.
  const heartbeat = createHeartbeat(f.deps);
  assert.deepEqual(await heartbeat.scan(), { notified: ["first"] }, "the chat takes one report per scan");
  assert.equal(f.notifications.length, 1);
  assert.match(f.notifications[0]?.text ?? "", /\[first\]\(\/sessions\/first\?open=app\)/u);
  // The skipped pair recorded no fingerprint, so the run end at that chat's turn end sends it from the facts then.
  await heartbeat.watcherIdle("watcher");
  assert.equal(f.notifications.length, 2, "the second report goes out at the run end, with no fact changed");
  assert.match(f.notifications[1]?.text ?? "", /\[second\]\(\/sessions\/second\?open=app\)/u);
  await heartbeat.watcherIdle("watcher");
  assert.equal(f.notifications.length, 2, "and only once: nothing is left pending");
  assert.deepEqual(await heartbeat.scan(), { notified: [] });
  assert.equal(f.notifications.length, 2);
});

test("a run end inside a delivery flushes the pair the scan held back, with the newest facts", async () => {
  const f = fixture();
  f.deps.records = async () => [
    session("watcher", undefined, { watches: ["first", "second"] }),
    session("first"),
    session("second"),
  ];
  const delivered: Array<{ id: string; text: string }> = [];
  const replies: Record<string, string> = { first: "First reply.", second: "Second reply: the migration is still running." };
  f.deps.lastAssistant = (id: string) => replies[id];
  let runEnd: Promise<void> | undefined;
  const heartbeat = createHeartbeat(f.deps);
  // The first delivery starts a turn that ends before that delivery resolves, so the chat's run end arrives while the
  // scan waits on it. The chat takes no busy flag: a second delivery would land the moment it was offered.
  f.deps.notify = async (id: string, text: string) => {
    delivered.push({ id, text });
    if (delivered.length !== 1) return;
    replies.second = "Second reply: the migration ran and its tests pass.";
    runEnd = heartbeat.watcherIdle(id);
  };
  assert.deepEqual(await heartbeat.scan(), { notified: ["first"] }, "the scan reports the first and holds the second back");
  assert.equal(delivered.length, 1);
  await runEnd;
  assert.equal(delivered.length, 2, "the run end delivers the pair the scan held back");
  assert.match(delivered[0]?.text ?? "", /\[first\]\(\/sessions\/first\?open=app\)/u);
  assert.match(delivered[0]?.text ?? "", /First reply\./u);
  assert.match(delivered[1]?.text ?? "", /\[second\]\(\/sessions\/second\?open=app\)/u);
  assert.match(delivered[1]?.text ?? "", /Second reply: the migration ran and its tests pass\./u, "recomputed from the newest facts");
  assert.doesNotMatch(delivered[1]?.text ?? "", /still running/u, "the old facts were never delivered");
  assert.deepEqual(await heartbeat.scan(), { notified: [] }, "nothing changed since");
  await heartbeat.watcherIdle("watcher");
  assert.equal(delivered.length, 2, "each pair went out exactly once");
});

test("a run end during a scan flushes the report that scan refused, before it finishes", async () => {
  const f = fixture();
  f.deps.records = async () => [
    session("first", undefined, { watches: ["target"] }),
    session("second", undefined, { watches: ["target"] }),
    session("target"),
  ];
  f.deps.lastAssistant = () => "First reply.";
  const first = refusingChat();
  first.state.busy = true;
  const second = refusingChat();
  let reached!: () => void;
  const waiting = new Promise<void>((resolve) => { reached = resolve; });
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  f.deps.notify = async (id, text) => {
    if (id === "first") await first.notify(id, text);
    else {
      reached();
      await blocked;
      await second.notify(id, text);
    }
  };
  const heartbeat = createHeartbeat(f.deps);
  const scan = heartbeat.scan();
  await waiting;
  // The first report was refused and the scan now waits for the second chat's delivery: this is the window in which the
  // first chat's turn ends and asks for what it is owed.
  first.state.busy = false;
  f.deps.lastAssistant = () => "Second reply: the migration ran and its tests pass.";
  const flush = heartbeat.watcherIdle("first");
  release();
  await Promise.all([scan, flush]);
  assert.equal(first.state.delivered.length, 1, "the run end delivered the refused report exactly once");
  assert.match(first.state.delivered[0]?.text ?? "", /Second reply: the migration ran and its tests pass\./u);
  assert.doesNotMatch(first.state.delivered[0]?.text ?? "", /First reply\./u, "recomputed from the newest facts");
  assert.deepEqual(await heartbeat.scan(), { notified: [] }, "nothing changed since");
  assert.equal(first.state.delivered.length, 1, "and it is not sent twice");
});

test("a watcher stops being pending when the watch it was owed a report for is removed", async () => {
  const f = fixture();
  const chat = refusingChat();
  f.deps.notify = chat.notify;
  let records: SessionRecord[] = [
    session("watcher", undefined, { watches: ["first", "second"] }),
    session("first"),
    session("second"),
  ];
  let reads = 0;
  f.deps.records = async () => { reads += 1; return records; };
  const heartbeat = createHeartbeat(f.deps);
  assert.deepEqual(await heartbeat.scan(), { notified: ["first"] });
  assert.equal(chat.state.delivered.length, 1, "the chat took one report and the watcher is owed the other");
  // The watch whose report never went out is removed while the one already reported stays: nothing is undelivered.
  records = [session("watcher", undefined, { watches: ["first"] }), session("first"), session("second")];
  assert.deepEqual(await heartbeat.scan(), { notified: [] });
  const before = reads;
  await heartbeat.watcherIdle("watcher");
  assert.equal(reads, before, "a run end with nothing pending reads nothing");
  assert.equal(chat.state.delivered.length, 1, "and it notifies nothing");
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
