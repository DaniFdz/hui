import assert from "node:assert/strict";
import { mock, test } from "node:test";

import {
  listedSessionGroups,
  reconnectDelay,
  STATUS_STREAM_STALL_MS,
  subscribeSessionStatuses,
  transcriptAsMarkdown,
  type RuntimeEvent,
  type SessionGroup,
  type SessionStatusUpdate,
  type SessionView,
} from "./sessions-store.ts";

test("session lists leave out temporary pull-request reviews", () => {
  const view = (id: string, temporary = false): SessionView => ({
    id, title: id, group: "", cwd: "/tmp", tool: "pi", status: "idle", createdAt: "", updatedAt: "",
    ...(temporary ? { temporary: { kind: "pr-review" as const, pullRequestUrl: "https://github.com/acme/web/pull/3" } } : {}),
  });
  const groups: SessionGroup[] = [
    { label: "Work", sessions: [view("a"), view("review-a", true)] },
    { label: "Empty", sessions: [] },
    { label: "ungrouped", sessions: [view("review-b", true)] },
  ];
  assert.deepEqual(listedSessionGroups(groups).map((group) => [group.label, group.sessions.map(({ id }) => id)]), [["Work", ["a"]], ["Empty", []]]);
  const plain = [{ label: "ungrouped", sessions: [view("b")] }];
  assert.equal(listedSessionGroups(plain), plain, "no temporary sessions: the same list");
});

test("the browser runtime contract includes settled", () => {
  const event: RuntimeEvent = { type: "settled" };
  assert.deepEqual(event, { type: "settled" });
});

test("conversation Markdown preserves visible message, thinking, tool and error rows", () => {
  assert.equal(transcriptAsMarkdown([
    { kind: "message", id: "u", role: "user", text: "Hello" },
    { kind: "thinking", id: "t", text: "Consider it" },
    { kind: "tool", id: "tool", name: "read", output: "done" },
    { kind: "error", id: "e", text: "Nope" },
  ]), "## User\n\nHello\n\n### Thinking\n\nConsider it\n\n### Tool: read\n\n```\ndone\n```\n\n### Error\n\nNope");
});

// `random() = 0` is the low edge of the equal-jitter band, so these read as the
// un-jittered curve.
test("reconnect backoff doubles, then holds at the cap", () => {
  assert.equal(reconnectDelay(1, () => 0), 250);
  assert.equal(reconnectDelay(2, () => 0), 500);
  assert.equal(reconnectDelay(3, () => 0), 1000);
  assert.equal(reconnectDelay(4, () => 0), 2000);
  assert.equal(reconnectDelay(5, () => 0), 2000);
  assert.equal(reconnectDelay(50, () => 0), 2000);
});

test("jitter stays inside the band and under the cap", () => {
  assert.equal(reconnectDelay(1, () => 1), 500);
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    const delay = reconnectDelay(attempt, () => 0.5);
    assert.ok(delay > 0 && delay <= 4000, `attempt ${attempt} produced ${delay}`);
  }
});

test("the browser demultiplexes lifecycle snapshot and status frames", async () => {
  const body = [
    "event: snapshot",
    'data: {"statuses":[{"id":"a","status":"running"}]}',
    "",
    "event: status",
    'data: {"id":"a","status":"idle"}',
    "",
    "event: sessions",
    'data: {"revision":2,"upserts":[]}',
    "",
    "",
  ].join("\n");
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(String(input), "/__hui/sessions/events");
    assert.deepEqual(init?.headers, { "x-hui": "1", accept: "text/event-stream" });
    return new Response(body, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
  }) as typeof fetch;
  const snapshots: Array<readonly SessionStatusUpdate[]> = [];
  const updates: SessionStatusUpdate[] = [];
  const lists: unknown[] = [];
  let finish!: () => void;
  const received = new Promise<void>((resolve) => { finish = resolve; });

  const stop = subscribeSessionStatuses({
    onSnapshot: (statuses) => snapshots.push(statuses),
    onStatus: (update) => updates.push(update),
    onSessions: (list) => {
      lists.push(list);
      finish();
    },
  }, fetcher);
  await received;
  stop();

  assert.deepEqual(snapshots, [[{ id: "a", status: "running" }]]);
  assert.deepEqual(updates, [{ id: "a", status: "idle" }]);
  assert.deepEqual(lists, [{ revision: 2, upserts: [] }]);
});

test("a status stream that goes silent reconnects to resync", async (t) => {
  mock.timers.enable({ apis: ["setTimeout"] });
  t.after(() => mock.timers.reset());
  let connections = 0;
  const fetcher = (async () => {
    connections += 1;
    return new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('event: snapshot\ndata: {"statuses":[]}\n\n'));
      },
    }), { status: 200, headers: { "content-type": "text/event-stream" } });
  }) as typeof fetch;
  const stop = subscribeSessionStatuses({ onSnapshot: () => {}, onStatus: () => {} }, fetcher);
  t.after(stop);
  const settle = async () => { for (let i = 0; i < 10; i += 1) await new Promise(setImmediate); };

  await settle();
  mock.timers.tick(STATUS_STREAM_STALL_MS - 1);
  await settle();
  assert.equal(connections, 1);
  mock.timers.tick(1);
  await settle();
  mock.timers.tick(reconnectDelay(1, () => 1));
  await settle();
  assert.equal(connections, 2);
});
