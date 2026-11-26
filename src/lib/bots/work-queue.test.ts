import assert from "node:assert/strict";
import { test } from "vitest";
import {
  botWorkQueue,
  botWorkQueues,
  EMPTY_WORK_QUEUE,
  sessionsInFlight,
  WORK_QUEUE_CAP,
  workLane,
  workLanes,
  workQueueHeadline,
  workQueueRows,
} from "./work-queue.ts";
import type { SessionView } from "../../api/sessions.ts";

function session(id: string, overrides: Partial<SessionView> = {}): SessionView {
  return {
    id,
    title: id,
    group: "g",
    cwd: "/work",
    displayCwd: "/work",
    tool: "durable",
    status: "idle",
    stage: "investigation",
    stageOrigin: "default",
    createdAt: "2026-11-20T09:00:00.000Z",
    updatedAt: "2026-11-20T09:00:00.000Z",
    ...overrides,
  } as SessionView;
}

const at = (minute: number) => `2026-11-20T09:${String(minute).padStart(2, "0")}:00.000Z`;

test("a question waiting and a failed run need the operator, counted once even when both apply", () => {
  assert.equal(workLane(session("a", { status: "waiting" })), "needs-you");
  assert.equal(workLane(session("a", { status: "waiting", runFailed: true })), "needs-you");
  const queue = botWorkQueue([session("a", { status: "waiting", runFailed: true })]);
  assert.deepEqual(queue.counts, { "needs-you": 1, working: 0, recent: 0 });
  assert.equal(queue.inFlight, 1, "a session is one lane and one count, never two");
  assert.equal(queue.rows.length, 1);
});

test("every lane boundary reads the status, not the stage", () => {
  for (const status of ["error", "disconnected"] as const) assert.equal(workLane(session("a", { status })), "needs-you", status);
  assert.equal(workLane(session("a", { status: "idle", runFailed: true })), "needs-you", "a run that failed and settled");
  for (const status of ["running", "starting", "reconnecting"] as const) assert.equal(workLane(session("a", { status })), "working", status);
  assert.equal(workLane(session("a", { status: "idle" })), "recent");
  assert.equal(workLane(session("a", { status: "idle", stage: "implementation" })), "recent", "a stage never moves a session");
  assert.equal(workLane(session("a", { status: "idle", creationError: "Could not create the worktree" })), "recent", "a failed worktree is not a status");
  // An idle session whose last run succeeded has no failed-run mark, whatever else the row carries.
  assert.equal(workLane(session("a", { status: "idle", runFailed: undefined })), "recent");
});

test("the queue lists lanes in order and Recent newest first, the id breaking ties", () => {
  const queue = botWorkQueue([
    session("old", { updatedAt: at(1) }),
    session("running", { status: "running", updatedAt: at(2) }),
    session("new", { updatedAt: at(9) }),
    session("waiting", { status: "waiting", updatedAt: at(3) }),
    session("tie-b", { updatedAt: at(5) }),
    session("tie-a", { updatedAt: at(5) }),
  ]);
  assert.deepEqual(queue.rows.map(({ session: each }) => each.id), ["waiting", "running", "new", "tie-a", "tie-b", "old"]);
  assert.deepEqual(queue.rows.map(({ lane }) => lane), ["needs-you", "working", "recent", "recent", "recent", "recent"]);
  assert.deepEqual(queue.counts, { "needs-you": 1, working: 1, recent: 4 });
  assert.equal(queue.inFlight, 2, "Recent never counts as in flight");
});

test("the panel draws the first eight rows and keeps the rest behind Show more", () => {
  const queue = botWorkQueue(Array.from({ length: 9 }, (_, index) => session(`s${index}`, { updatedAt: at(index) })));
  assert.equal(WORK_QUEUE_CAP, 8);
  const collapsed = workQueueRows(queue, false);
  assert.equal(collapsed.rows.length, 8);
  assert.equal(collapsed.more, 1);
  const expanded = workQueueRows(queue, true);
  assert.equal(expanded.rows.length, 9);
  assert.equal(expanded.more, 1, "the count of what waited stays known while it shows");
  assert.deepEqual(workQueueRows(botWorkQueue([session("only")]), false), { rows: [{ lane: "recent", session: session("only") }], more: 0 });
});

test("a capped queue keeps lane order and its lane labels", () => {
  const queue = botWorkQueue([
    session("waiting", { status: "waiting", updatedAt: at(0) }),
    session("running", { status: "running", updatedAt: at(1) }),
    ...Array.from({ length: 8 }, (_, index) => session(`done${index}`, { updatedAt: at(index + 2) })),
  ]);
  const { rows, more } = workQueueRows(queue, false);
  assert.equal(more, 2);
  assert.deepEqual(workLanes(rows).map(({ label, rows: group }) => [label, group.length]), [["Needs you", 1], ["Working", 1], ["Recent", 6]]);
  assert.deepEqual(workLanes(workQueueRows(queue, true).rows).map(({ rows: group }) => group.length), [1, 1, 8]);
  assert.deepEqual(workLanes([]), []);
});

test("the headline counts the lanes it has and leaves a zero lane out", () => {
  assert.equal(workQueueHeadline(EMPTY_WORK_QUEUE.counts), "");
  assert.equal(workQueueHeadline({ "needs-you": 1, working: 2, recent: 0 }), "1 needs you · 2 working");
  assert.equal(workQueueHeadline({ "needs-you": 0, working: 0, recent: 7 }), "7 recent");
  assert.equal(workQueueHeadline({ "needs-you": 2, working: 0, recent: 1 }), "2 needs you · 1 recent");
});

test("one queue per bot comes from the membership index the sidebar already holds", () => {
  const queues = botWorkQueues(new Map([
    ["ada", [session("a", { status: "running" }), session("b", { status: "waiting" })]],
    ["empty", []],
  ]));
  assert.deepEqual([...queues.keys()], ["ada"], "a bot that started nothing has no queue to draw");
  assert.deepEqual(queues.get("ada")?.counts, { "needs-you": 1, working: 1, recent: 0 });
  assert.equal(sessionsInFlight(1), "1 session in flight");
  assert.equal(sessionsInFlight(2), "2 sessions in flight");
});
