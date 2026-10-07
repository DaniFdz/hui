import assert from "node:assert/strict";
import { test } from "node:test";
import { endedInError, SessionWatch, sessionWatchable, type SessionEvent } from "./bot-triggers-session.ts";
import type { SessionStatusUpdate } from "./live-sessions.ts";
import type { TranscriptEntry } from "./runtimes/types.ts";
import type { SessionRecord } from "./sessions.ts";

test("a bot's session triggers watch only the sessions it started itself", () => {
  const bot = { sessionId: "chat-ada" };
  assert.equal(sessionWatchable(bot, { id: "child", parentId: "chat-ada" }), true);
  assert.equal(sessionWatchable(bot, { id: "other", parentId: "chat-bob" }), false, "another bot's");
  assert.equal(sessionWatchable(bot, { id: "plain" }), false, "a session nobody started");
  assert.equal(sessionWatchable(bot, { id: "chat-ada" }), false, "its own chat");
  assert.equal(sessionWatchable(bot, { id: "chat-bob", parentId: "chat-ada", bot: "id-bob" }), false, "another bot's chat");
});

test("the watch reports a run that finished, failed or waits for an answer, and nothing while no trigger wants it", async () => {
  let subscriber: ((update: SessionStatusUpdate) => void) | undefined;
  const transcripts = new Map<string, TranscriptEntry[]>([
    ["done", [{ kind: "message", role: "user", text: "go" }, { kind: "message", role: "assistant", text: "All tests pass now." }]],
    ["broken", [{ kind: "message", role: "user", text: "go" }, { kind: "error", message: "Provider refused the request." }]],
  ]);
  const records: SessionRecord[] = ["done", "broken", "asking", "booting"].map((id) => ({ id, title: `Session ${id}`, cwd: "/work", group: "", tool: "durable", createdAt: "", updatedAt: "" }));
  const events: SessionEvent[] = [];
  let wanted = true;
  const watch = new SessionWatch({
    sessions: {
      watchStatuses: (listener) => { subscriber = listener; return { statuses: [{ id: "done", status: "running" }], unsubscribe: () => { subscriber = undefined; } }; },
      transcript: (id) => transcripts.get(id) ?? [],
      snapshot: () => ({ questions: [{ id: "q", method: "confirm", title: "Deploy to production?", message: "" }] }) as never,
    },
    readSessions: async () => records,
    wanted: () => wanted,
    onEvent: (event) => { events.push(event); },
    now: () => Date.parse("2026-10-07T10:00:00Z"),
  });
  watch.start();
  const settle = () => new Promise((resolve) => setTimeout(resolve, 10));
  subscriber!({ id: "done", status: "idle" });
  subscriber!({ id: "broken", status: "running" });
  subscriber!({ id: "broken", status: "idle" });
  subscriber!({ id: "asking", status: "running" });
  subscriber!({ id: "asking", status: "waiting" });
  subscriber!({ id: "booting", status: "starting" });
  subscriber!({ id: "booting", status: "idle" });
  subscriber!({ id: "booting", status: "error" });
  await settle();
  assert.deepEqual(events.map((event) => [event.record.id, event.kind]), [["done", "finished"], ["broken", "failed"], ["asking", "waiting"], ["booting", "failed"]]);
  assert.equal(events[0]!.summary, "\"Session done\" finished");
  assert.match(events[0]!.details, /^"Session done" \(session done, in \/work\)\n {2}Last reply:\n {2}> All tests pass now\.$/u);
  assert.match(events[1]!.details, /Error: Provider refused the request\./u);
  assert.match(events[2]!.details, /Asks: Deploy to production\?/u);
  wanted = false;
  subscriber!({ id: "done", status: "running" });
  subscriber!({ id: "done", status: "idle" });
  await settle();
  assert.equal(events.length, 4, "no session trigger: nothing");
  watch.stop();
  assert.equal(subscriber, undefined);
  assert.equal(endedInError([]), undefined);
});
