/**
 * The Dashboard's session projection: each status in the lane that names what the operator can do with it, a failed
 * turn in Fix and not in Unread, lane order and order inside each lane, what is not a session in flight (finished,
 * archived, subagents), each filter dimension and the choices the operator can pick them from.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import type { SessionGroup, SessionView } from "../api/schema/sessions.ts";
import {
  EMPTY_FILTERS, LOCAL_WORKER, laneOf, matchesFilters, filterOptions, summarizeSessions,
  type SessionFilters, type SessionLaneKey, type SessionSummary,
} from "./dashboard.ts";

function session(id: string, overrides: Partial<SessionView> = {}): SessionView {
  return {
    id, title: `Session ${id}`, group: "", cwd: "/work", displayCwd: "~/work", tool: "pi", status: "idle",
    stage: "investigation", stageOrigin: "default", createdAt: "2026-10-23T10:00:00Z", updatedAt: "2026-10-23T11:00:00Z",
    ...overrides,
  };
}

const listed = (...sessions: SessionView[]): SessionGroup[] => [{ label: "", sessions }];
const ids = (sessions: readonly SessionView[]) => sessions.map(({ id }) => id);
const lane = (summary: SessionSummary, key: SessionLaneKey) => summary.lanes.find((entry) => entry.key === key)!.sessions;
const shown = (summary: SessionSummary) => ids(summary.lanes.flatMap((entry) => entry.sessions));
const matched = (groups: readonly SessionGroup[], filters: Partial<SessionFilters>) =>
  shown(summarizeSessions(groups, { ...EMPTY_FILTERS, ...filters }));

test("each status lands in the lane that says what the operator can do, and all five lanes are always there", () => {
  assert.equal(laneOf(session("s", { status: "waiting" })), "answer");
  assert.equal(laneOf(session("s", { status: "error" })), "fix");
  assert.equal(laneOf(session("s", { status: "disconnected" })), "fix");
  assert.equal(laneOf(session("s", { status: "running" })), "flight");
  assert.equal(laneOf(session("s", { status: "starting" })), "flight");
  assert.equal(laneOf(session("s", { status: "reconnecting" })), "flight");
  assert.equal(laneOf(session("s", { status: "idle", unread: true })), "unread");
  assert.equal(laneOf(session("s", { status: "idle" })), "parked");

  const summary = summarizeSessions(listed(
    session("waiting", { status: "waiting" }),
    session("failed", { status: "idle", runFailed: true, updatedAt: "2026-10-23T11:54:00Z" }),
    session("error", { status: "error", updatedAt: "2026-10-23T11:55:00Z" }),
    session("disconnected", { status: "disconnected", updatedAt: "2026-10-23T11:56:00Z" }),
    session("unread", { status: "idle", unread: true }),
    session("running", { status: "running" }),
    session("starting", { status: "starting" }),
    session("reconnecting", { status: "reconnecting" }),
    session("parked", { status: "idle" }),
  ));
  assert.deepEqual(summary.lanes.map(({ key, label }) => [key, label]), [
    ["answer", "Answer"], ["fix", "Fix"], ["unread", "Unread"], ["flight", "In flight"], ["parked", "Parked"],
  ], "lane order and labels are fixed");
  assert.deepEqual(ids(lane(summary, "answer")), ["waiting"]);
  assert.deepEqual(ids(lane(summary, "fix")), ["failed", "error", "disconnected"]);
  assert.deepEqual(ids(lane(summary, "unread")), ["unread"]);
  assert.deepEqual(ids(lane(summary, "flight")).sort(), ["reconnecting", "running", "starting"]);
  assert.deepEqual(ids(lane(summary, "parked")), ["parked"]);

  const empty = summarizeSessions([]);
  assert.deepEqual(empty.lanes.map((entry) => entry.key), ["answer", "fix", "unread", "flight", "parked"]);
  assert.deepEqual(empty.lanes.map((entry) => entry.sessions.length), [0, 0, 0, 0, 0]);
  assert.equal(empty.total, 0);
  assert.equal(empty.matched, 0);
  assert.equal(empty.finished, 0);
});

test("a failed turn settles idle, so an idle session with runFailed is Fix whatever its unread answer", () => {
  assert.equal(laneOf(session("s", { status: "idle", runFailed: true })), "fix", "the common failure is a failed turn, not a dead runtime");
  assert.equal(laneOf(session("s", { status: "idle", runFailed: true, unread: true })), "fix", "an unread answer never hides a failed run");
  assert.equal(laneOf(session("s", { status: "error", unread: true })), "fix", "a dead runtime is Fix even with something to read");
  assert.equal(laneOf(session("s", { status: "running", runFailed: true })), "flight", "a run going again is in flight, whatever the turn before it did");
  assert.equal(laneOf(session("s", { status: "waiting", runFailed: true })), "answer", "a question comes before a stop");
  assert.equal(laneOf(session("s", { status: "idle", unread: true })), "unread", "without a failed run an idle session waits to be read");
  assert.equal(laneOf(session("s", { status: "idle" })), "parked");
});

test("the wider Fix lane keeps its order: the longest wait first, a failed turn beside a dead runtime", () => {
  const summary = summarizeSessions(listed(
    session("failed", { status: "idle", runFailed: true, failure: "the API key expired", updatedAt: "2026-10-23T11:40:00Z" }),
    session("crashed", { status: "error", updatedAt: "2026-10-23T07:00:00Z" }),
    session("offline", { status: "disconnected", updatedAt: "2026-10-23T11:50:00Z" }),
    session("again", { status: "running", runFailed: true, updatedAt: "2026-10-23T11:59:00Z" }),
    session("unread", { status: "idle", unread: true }),
    session("parked", { status: "idle" }),
  ));
  assert.deepEqual(ids(lane(summary, "fix")), ["crashed", "failed", "offline"]);
  assert.deepEqual(ids(lane(summary, "flight")), ["again"], "a session that is running again left Fix");
  assert.deepEqual(ids(lane(summary, "unread")), ["unread"]);
  assert.deepEqual(ids(lane(summary, "parked")), ["parked"]);
});

test("a session idle in Done is finished: counted apart, in no lane, and never matched", () => {
  const groups = listed(
    session("done", { status: "idle", stage: "done", unread: true }),
    session("error-done", { status: "error", stage: "done" }),
    session("running", { status: "running" }),
  );
  const summary = summarizeSessions(groups);
  assert.equal(summary.finished, 1);
  assert.equal(summary.total, 2, "a stopped session in Done is still in flight");
  assert.equal(summary.matched, 2);
  assert.deepEqual(ids(lane(summary, "fix")), ["error-done"]);
  assert.deepEqual(ids(lane(summary, "unread")), [], "an unread session in Done is finished, not unread");
  assert.equal(summary.statuses.idle, 0, "finished is counted apart, not as an idle session in flight");

  const idleOnly = summarizeSessions(groups, { ...EMPTY_FILTERS, status: "idle" });
  assert.equal(idleOnly.total, 2);
  assert.equal(idleOnly.matched, 0);
  assert.equal(idleOnly.finished, 1, "the finished count describes the registry, not the filtered lanes");
});

test("archived sessions and subagents stay out of every lane, and subagents count on their parent", () => {
  const summary = summarizeSessions(listed(
    session("archived", { status: "waiting", archived: true }),
    session("archived-child", { status: "running", parentId: "archived", archived: true }),
    session("parent", { status: "running" }),
    session("busy-child", { status: "running", parentId: "parent" }),
    session("parked-child", { status: "idle", parentId: "parent" }),
  ));
  assert.equal(summary.total, 1);
  assert.deepEqual(ids(lane(summary, "flight")), ["parent"]);
  assert.deepEqual(ids(lane(summary, "answer")), [], "an archived question is not the operator's");
  assert.deepEqual([...summary.subagents], [["parent", { total: 2, active: 1 }]], "an idle subagent counts but is not active");
  assert.equal(summary.statuses.running, 1, "a subagent never counts as a session in flight");
});

test("each lane leads with the session to pick up first: longest wait first, newest first in flight, an unreadable time last", () => {
  const summary = summarizeSessions(listed(
    session("answer-late", { status: "waiting", updatedAt: "2026-10-23T11:50:00Z" }),
    session("answer-early", { status: "waiting", updatedAt: "2026-10-23T08:00:00Z" }),
    session("answer-unknown", { status: "waiting", updatedAt: "someday" }),
    session("fix-late", { status: "error", updatedAt: "2026-10-23T11:40:00Z" }),
    session("fix-early", { status: "disconnected", updatedAt: "2026-10-23T07:00:00Z" }),
    session("fix-failed", { status: "idle", runFailed: true, updatedAt: "2026-10-23T08:30:00Z" }),
    session("fix-unknown", { status: "error", updatedAt: "" }),
    session("unread-late", { status: "idle", unread: true, updatedAt: "2026-10-23T11:30:00Z" }),
    session("unread-early", { status: "idle", unread: true, updatedAt: "2026-10-23T06:00:00Z" }),
    session("unread-unknown", { status: "idle", unread: true, updatedAt: "not a date" }),
    session("flight-new", { status: "running", updatedAt: "2026-10-23T11:59:00Z" }),
    session("flight-old", { status: "starting", updatedAt: "2026-10-23T09:00:00Z" }),
    session("flight-unknown", { status: "reconnecting", updatedAt: "??" }),
    session("parked-late", { status: "idle", updatedAt: "2026-10-23T11:20:00Z" }),
    session("parked-early", { status: "idle", updatedAt: "2026-10-23T05:00:00Z" }),
    session("parked-unknown", { status: "idle", updatedAt: "" }),
  ));
  assert.deepEqual(ids(lane(summary, "answer")), ["answer-early", "answer-late", "answer-unknown"]);
  assert.deepEqual(ids(lane(summary, "fix")), ["fix-early", "fix-failed", "fix-late", "fix-unknown"]);
  assert.deepEqual(ids(lane(summary, "unread")), ["unread-early", "unread-late", "unread-unknown"]);
  assert.deepEqual(ids(lane(summary, "flight")), ["flight-new", "flight-old", "flight-unknown"], "in flight, newest first");
  assert.deepEqual(ids(lane(summary, "parked")), ["parked-early", "parked-late", "parked-unknown"]);
});

test("each filter dimension narrows the lanes on its own, and no filter leaves every lane", () => {
  const groups: SessionGroup[] = [
    { label: "Alpha", sessions: [
      session("alpha-run", { group: "Alpha", status: "running", stage: "implementation", worker: { id: "w1", name: "Workspace One" } }),
      session("alpha-local", { group: "Alpha", status: "idle", stage: "implementation" }),
    ] },
    { label: "Beta", sessions: [
      session("beta-error", { group: "Beta", status: "error", stage: "testing", worker: { id: "w2", name: "Workspace Two" } }),
    ] },
  ];
  assert.deepEqual(matched(groups, {}), ["beta-error", "alpha-run", "alpha-local"], "fix, then flight, then parked");
  assert.deepEqual(matched(groups, { group: "Alpha" }), ["alpha-run", "alpha-local"]);
  assert.deepEqual(matched(groups, { status: "error" }), ["beta-error"]);
  assert.deepEqual(matched(groups, { worker: "w1" }), ["alpha-run"]);
  assert.deepEqual(matched(groups, { worker: LOCAL_WORKER }), ["alpha-local"], "a session with no worker is this gateway's");
  assert.deepEqual(matched(groups, { stage: "testing" }), ["beta-error"]);
});

test("filter dimensions combine with AND", () => {
  const groups: SessionGroup[] = [
    { label: "Alpha", sessions: [
      session("alpha-run", { group: "Alpha", status: "running", stage: "implementation", worker: { id: "w1", name: "Workspace One" } }),
      session("alpha-error", { group: "Alpha", status: "error", stage: "implementation", worker: { id: "w2", name: "Workspace Two" } }),
    ] },
    { label: "Beta", sessions: [
      session("beta-run", { group: "Beta", status: "running", stage: "implementation", worker: { id: "w1", name: "Workspace One" } }),
    ] },
  ];
  assert.deepEqual(matched(groups, { group: "Alpha", status: "running" }), ["alpha-run"]);
  assert.deepEqual(matched(groups, { group: "Alpha", status: "error" }), ["alpha-error"]);
  assert.deepEqual(matched(groups, { group: "Alpha", worker: "w2", stage: "implementation" }), ["alpha-error"]);
  assert.deepEqual(matched(groups, { group: "Beta", stage: "testing" }), [], "one dimension that fails hides the session");
  assert.deepEqual(matched(groups, { group: "Beta", worker: "w1", status: "running" }), ["beta-run"]);
});

test("the text query reads the title, displayed path and group, trimmed and case-insensitive", () => {
  const groups = listed(
    session("title", { title: "Retry-safe checkout" }),
    session("path", { displayCwd: "~/work/HUI" }),
    session("group", { group: "Payments" }),
    session("other", { title: "Something else", displayCwd: "/tmp", group: "Other" }),
  );
  assert.deepEqual(matched(groups, { query: "  RETRY  " }), ["title"]);
  assert.deepEqual(matched(groups, { query: "hui" }), ["path"]);
  assert.deepEqual(matched(groups, { query: "payments" }), ["group"]);
  assert.deepEqual(matched(groups, { query: "nothing" }), []);
  assert.equal(matched(groups, { query: "   " }).length, 4, "a blank query is no filter");
});

test("total counts every session in flight while matched and the counts follow the filters", () => {
  const summary = summarizeSessions(listed(
    session("run", { status: "running" }),
    session("wait", { status: "waiting" }),
    session("idle", { status: "idle" }),
    session("done", { status: "idle", stage: "done" }),
  ), { ...EMPTY_FILTERS, status: "waiting" });
  assert.equal(summary.total, 3);
  assert.equal(summary.matched, 1);
  assert.equal(summary.finished, 1);
  assert.deepEqual(summary.statuses, { waiting: 1, error: 0, disconnected: 0, reconnecting: 0, running: 0, starting: 0, idle: 0 });
  assert.deepEqual(summary.stages, { investigation: 1, implementation: 0, testing: 0, done: 0 });
  assert.deepEqual(shown(summary), ["wait"]);
});

test("filter choices count every session in flight and leave out a value that never occurs", () => {
  const groups: SessionGroup[] = [
    { label: "Alpha", sessions: [
      session("alpha-run", { group: "Alpha", status: "running", stage: "implementation", worker: { id: "w", name: "Workspace" } }),
      session("alpha-test", { group: "Alpha", status: "running", stage: "testing" }),
      session("beta-error", { group: "Beta", status: "error", stage: "done" }),
    ] },
    { label: "", sessions: [
      session("finished", { status: "idle", stage: "done" }),
      session("child", { parentId: "alpha-run", status: "running" }),
      session("archived", { status: "waiting", archived: true }),
    ] },
  ];
  const options = filterOptions(groups);
  assert.deepEqual(options.groups, [
    { value: "Alpha", label: "ALPHA", count: 2 },
    { value: "Beta", label: "BETA", count: 1 },
  ], "an ungrouped session offers no choice: the empty value already means every group");
  assert.deepEqual(options.statuses, [
    { value: "running", label: "Running", count: 2 },
    { value: "error", label: "Error", count: 1 },
  ], "the archived question never becomes a choice");
  assert.deepEqual(options.workers, [
    { value: LOCAL_WORKER, label: "This gateway", count: 2 },
    { value: "w", label: "Workspace", count: 1 },
  ]);
  assert.deepEqual(options.stages, [
    { value: "done", label: "Done", count: 1 },
    { value: "implementation", label: "Implementation", count: 1 },
    { value: "testing", label: "Testing", count: 1 },
  ], "counts tie, so labels order the list");

  const betaOnly = summarizeSessions(groups, { ...EMPTY_FILTERS, group: "Beta" });
  assert.deepEqual(shown(betaOnly), ["beta-error"]);
  assert.deepEqual(filterOptions(groups).groups.map(({ value }) => value), ["Alpha", "Beta"], "a filter never removes a choice");
});

test("matchesFilters reads only the five dimensions and treats an empty value as no filter", () => {
  const stuck = session("stuck", {
    title: "Fix the retry", displayCwd: "~/repo", group: "Alpha", status: "error", stage: "testing",
    worker: { id: "w", name: "Workspace" },
  });
  assert.equal(matchesFilters(stuck, EMPTY_FILTERS), true);
  assert.equal(matchesFilters(stuck, { ...EMPTY_FILTERS, group: "Alpha" }), true);
  assert.equal(matchesFilters(stuck, { ...EMPTY_FILTERS, group: "Beta" }), false);
  assert.equal(matchesFilters(stuck, { ...EMPTY_FILTERS, status: "error" }), true);
  assert.equal(matchesFilters(stuck, { ...EMPTY_FILTERS, status: "waiting" }), false);
  assert.equal(matchesFilters(stuck, { ...EMPTY_FILTERS, stage: "testing" }), true);
  assert.equal(matchesFilters(stuck, { ...EMPTY_FILTERS, stage: "done" }), false);
  assert.equal(matchesFilters(stuck, { ...EMPTY_FILTERS, worker: "w" }), true);
  assert.equal(matchesFilters(stuck, { ...EMPTY_FILTERS, worker: LOCAL_WORKER }), false);
  assert.equal(matchesFilters(stuck, { ...EMPTY_FILTERS, query: " REPO " }), true);
  assert.equal(matchesFilters(stuck, { ...EMPTY_FILTERS, query: "elsewhere" }), false);
});
