import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";
import { RuntimeTimings, sanitizeMetrics, timingEvent } from "./transcript-metrics.ts";
import { transcriptFrom } from "./pi.ts";

const fixtures: { input: unknown; expected: unknown }[] = JSON.parse(readFileSync(new URL("./transcript-metrics.fixture.json", import.meta.url), "utf8"));

test("sanitizeMetrics preserves the shared runtime fixtures", () => {
  for (const { input, expected } of fixtures) assert.deepEqual(sanitizeMetrics(input), expected, JSON.stringify(input));
});

test("correlates model and tool measurements and never derives time from adjacent messages", () => {
  const timings = new RuntimeTimings();
  const message = { role: "assistant", timestamp: 100, content: [{ type: "thinking", thinking: "Plan" }, { type: "text", text: "Answer" }], usage: { input: 12, output: 3, cacheRead: 0, cost: { total: 0 } } };
  timings.observe({ type: "message_start", message }, 1000);
  timings.observe({ type: "tool_execution_start", toolCallId: "tool" }, 1010);
  timings.observe({ type: "tool_execution_end", toolCallId: "tool" }, 1030);
  timings.observe({ type: "message_end", message }, 1087);
  const entries = transcriptFrom([message], timings);
  // The reasoning shares the message's own span, without the message's duration: only the part its measurement is about
  // carries that.
  assert.deepEqual(entries[0]?.metrics, { timestamp: 100, completedAt: 1087 });
  assert.deepEqual(entries[1]?.metrics, { timestamp: 100, completedAt: 1087, durationMs: 87, inputTokens: 12, outputTokens: 3, cacheReadTokens: 0, costUsd: 0 });
  assert.deepEqual(timings.get("tool", "tool", 100), { completedAt: 1030, durationMs: 20 });
  assert.equal(transcriptFrom([message])[1]?.metrics?.durationMs, undefined);
  assert.equal(transcriptFrom([message])[1]?.metrics?.completedAt, undefined);
});
test("unpaired completion reports its instant but not a fabricated duration", () => {
  const timings = new RuntimeTimings();
  timings.observe({ type: "message_end", message: { role: "assistant", timestamp: 10 } }, 200);
  assert.deepEqual(timings.get("message", 10), { completedAt: 200 });
  timings.observe({ type: "message_end", message: { role: "user", timestamp: 11 } }, 210);
  assert.deepEqual(timings.get("message", 11), {});
});

test("reused tool IDs never overwrite an earlier model call's timing", () => {
  const timings = new RuntimeTimings();
  for (const timestamp of [100, 200]) {
    timings.observe({ type: "message_start", message: { role: "assistant", timestamp } }, timestamp);
    timings.observe({ type: "tool_execution_start", toolCallId: "same" }, timestamp);
    timings.observe({ type: "tool_execution_end", toolCallId: "same" }, timestamp + timestamp / 10);
  }
  assert.equal(timings.get("tool", "same", 100).durationMs, 10);
  assert.equal(timings.get("tool", "same", 200).durationMs, 20);
  assert.deepEqual(timings.get("tool", "same", 50), {});
});

test("tool-only model calls retain usage once without calling model time tool time", () => {
  const entries = transcriptFrom([{ role: "assistant", timestamp: 123,
    content: [{ type: "toolCall", id: "a", name: "read" }, { type: "toolCall", id: "b", name: "read" }],
    usage: { input: 5, output: 2 } }]);
  // A call that is not the message's measured part still proves when the message started; the usage is the message's.
  assert.deepEqual(entries[0]?.metrics, { timestamp: 123 });
  assert.deepEqual(entries[1]?.metrics, { timestamp: 123, inputTokens: 5, outputTokens: 2 });
});

test("timingEvent reads Durable's events the way RuntimeTimings measures them", () => {
  const message = { role: "assistant", timestamp: 1000, content: [] };
  assert.deepEqual(
    timingEvent({ type: "message_start", message }),
    { type: "message_start", message, toolCallId: undefined },
  );
  assert.deepEqual(
    timingEvent({ type: "tool_execution_start", toolCallId: "tool-1" }),
    { type: "tool_execution_start", message: undefined, toolCallId: "tool-1" },
  );
  assert.deepEqual(
    timingEvent({ type: "tool_execution_end", toolCallId: "tool-1" }),
    { type: "tool_execution_end", message: undefined, toolCallId: "tool-1" },
  );
  // Durable reports the committed entry, not the message PI puts on its own `message_end`.
  assert.deepEqual(
    timingEvent({ type: "message_end", entry: { model: [message] } }),
    { type: "message_end", message },
  );
  assert.deepEqual(timingEvent({ type: "entry_appended", entry: {} }), {});
  assert.deepEqual(timingEvent({ type: "snapshot" }), {});
  assert.deepEqual(timingEvent({ type: "message_end", entry: { model: [] } }), { type: "message_end", message: undefined });
  assert.deepEqual(timingEvent({ type: "message_end", entry: {} }), { type: "message_end", message: undefined });
  assert.deepEqual(timingEvent({}), {});
  assert.deepEqual(timingEvent({ type: 7, message: "nonsense" }), {});
  assert.deepEqual(timingEvent(undefined as unknown as Parameters<typeof timingEvent>[0]), {});
});

/** The two tool rounds of a Durable chat: the answer that declares each call, its result, and the events Durable
 * publishes for them, which are `message_start` (the streamed partial or the committed answer), the call, its end and
 * the entry that closes it. The call's measurement is keyed on the answer's timestamp, as `transcriptFrom` reads it. */
function twoRounds(): { timings: RuntimeTimings; messages: Record<string, unknown>[] } {
  const first = { role: "assistant", timestamp: 1000, content: [{ type: "toolCall", id: "tool-1", name: "bash", arguments: {} }] };
  const firstResult = { role: "toolResult", toolCallId: "tool-1", toolName: "bash", content: [{ type: "text", text: "one" }], timestamp: 1045 };
  const second = { role: "assistant", timestamp: 2000, content: [{ type: "toolCall", id: "tool-2", name: "bash", arguments: {} }] };
  const secondResult = { role: "toolResult", toolCallId: "tool-2", toolName: "bash", content: [{ type: "text", text: "two" }], timestamp: 2035 };
  const timings = new RuntimeTimings();
  const observe = (event: Parameters<typeof timingEvent>[0], now: number) => timings.observe(timingEvent(event), now);
  observe({ type: "message_start", message: first }, 900);
  observe({ type: "tool_execution_start", toolCallId: "tool-1" }, 1000);
  observe({ type: "tool_execution_end", toolCallId: "tool-1" }, 1030);
  observe({ type: "message_end", entry: { model: [first] } }, 1040);
  // The result's own end is ignored: only an answer's timestamp names a message measurement.
  observe({ type: "message_end", entry: { model: [firstResult] } }, 1050);
  observe({ type: "message_start", message: second }, 1900);
  observe({ type: "tool_execution_start", toolCallId: "tool-2" }, 2000);
  observe({ type: "tool_execution_end", toolCallId: "tool-2" }, 2020);
  observe({ type: "message_end", entry: { model: [second] } }, 2030);
  observe({ type: "message_end", entry: { model: [secondResult] } }, 2040);
  return { timings, messages: [first, firstResult, second, secondResult] };
}

test("a Durable round is measured under the timestamp of the answer that declared its call", () => {
  const { timings } = twoRounds();
  assert.deepEqual(timings.get("tool", "tool-1", 1000), { completedAt: 1030, durationMs: 30 });
  assert.deepEqual(timings.get("tool", "tool-2", 2000), { completedAt: 2020, durationMs: 20 });
  // The other answer's timestamp is a different call: a reused ID never borrows a neighbouring round's measurement.
  assert.deepEqual(timings.get("tool", "tool-1", 2000), {});
  assert.deepEqual(timings.get("tool", "tool-2", 1000), {});
  assert.deepEqual(timings.get("message", 1000), { completedAt: 1040, durationMs: 140 });
  assert.deepEqual(timings.get("message", 2000), { completedAt: 2030, durationMs: 130 });
});

test("transcriptFrom attaches a Durable round's measurement to the tool card the product draws", () => {
  const { timings, messages } = twoRounds();
  const entries = transcriptFrom(messages, timings);
  const card = (id: string) => entries.find((entry) => entry.kind === "tool" && entry.id === id);
  assert.equal(card("tool-1")?.metrics?.durationMs, 30);
  assert.equal(card("tool-1")?.metrics?.completedAt, 1030);
  assert.equal(card("tool-2")?.metrics?.durationMs, 20);
  assert.equal(card("tool-2")?.metrics?.completedAt, 2020);
  // Without the measurements the same card carries none: nothing is inferred from the result beside it.
  const untimed = transcriptFrom(messages).find((entry) => entry.kind === "tool" && entry.id === "tool-1");
  assert.equal(untimed?.metrics?.durationMs, undefined);
  assert.equal(untimed?.metrics?.completedAt, undefined);
});

test("a call that starts before its answer is committed is still measured, on the answer that declared it", () => {
  // Durable can publish a call before the `message_start` of the entry declaring it, so the start has no message to be
  // keyed on yet. The call ID is the pair of the two events; the completed entry still lands under the answer.
  const message = { role: "assistant", timestamp: 2000, content: [{ type: "toolCall", id: "tool-1", name: "bash", arguments: {} }] };
  const timings = new RuntimeTimings();
  const observe = (event: Parameters<typeof timingEvent>[0], now: number) => timings.observe(timingEvent(event), now);
  observe({ type: "message_start", message: { role: "assistant", timestamp: 1000, content: [] } }, 900);
  observe({ type: "tool_execution_start", toolCallId: "tool-1" }, 1900);
  observe({ type: "message_start", message }, 1990);
  observe({ type: "tool_execution_end", toolCallId: "tool-1" }, 1930);
  observe({ type: "message_end", entry: { model: [message] } }, 1995);
  assert.deepEqual(timings.get("tool", "tool-1", 2000), { completedAt: 1930, durationMs: 30 });
  // The earlier answer's round never borrows it: the call began before that answer named the round being measured.
  assert.deepEqual(timings.get("tool", "tool-1", 1000), {});
  const card = transcriptFrom([message], timings).find((entry) => entry.kind === "tool");
  assert.equal(card?.metrics?.durationMs, 30);
  assert.equal(card?.metrics?.completedAt, 1930);
});

test("every reasoning and call of an answer proves when the message started, so a trail can span its one turn", () => {
  const message = {
    role: "assistant",
    timestamp: 1_000,
    content: [
      { type: "thinking", thinking: "Plan" },
      { type: "toolCall", id: "a", name: "read", arguments: {} },
      { type: "toolCall", id: "b", name: "edit", arguments: {} },
      { type: "text", text: "Done" },
    ],
    usage: { input: 5, output: 2 },
  };
  const timings = new RuntimeTimings();
  const observe = (event: Parameters<typeof timingEvent>[0], now: number) => timings.observe(timingEvent(event), now);
  observe({ type: "message_start", message }, 1_000);
  observe({ type: "tool_execution_start", toolCallId: "a" }, 1_010);
  observe({ type: "tool_execution_end", toolCallId: "a" }, 3_000);
  observe({ type: "tool_execution_start", toolCallId: "b" }, 11_500);
  observe({ type: "tool_execution_end", toolCallId: "b" }, 13_000);
  observe({ type: "message_end", entry: { model: [message] } }, 13_087);
  const entries = transcriptFrom([message], timings);
  const thinking = entries.find((entry) => entry.kind === "thinking");
  const calls = entries.filter((entry) => entry.kind === "tool");
  // The reasoning shares the message's span without its duration: `renderMetrics` draws no "Completed in …" for it.
  assert.equal(thinking?.metrics?.durationMs, undefined);
  assert.deepEqual(thinking?.metrics, { timestamp: 1_000, completedAt: 13_087 });
  // Both calls prove the same message start, whichever one the message's own measurement landed on.
  assert.deepEqual(calls.map((entry) => entry.metrics?.timestamp), [1_000, 1_000]);
  assert.deepEqual(calls.map((entry) => entry.metrics?.completedAt), [3_000, 13_000]);
  // A settled trail spans from the message's start to the last call's end: 12 s of work nothing could measure before.
  assert.equal(Math.max(...calls.map((entry) => entry.metrics?.completedAt ?? 0)) - (thinking?.metrics?.timestamp ?? 0), 12_000);
});

test("a thinking part beside later text carries the message's span and no non-finites", () => {
  const message = { role: "assistant", timestamp: 42, content: [{ type: "thinking", thinking: "Plan" }, { type: "text", text: "Done" }] };
  const timings = new RuntimeTimings();
  timings.observe({ type: "message_start", message }, 40);
  timings.observe({ type: "message_end", message }, 90);
  const [thinking, answer] = transcriptFrom([message], timings);
  assert.deepEqual(thinking?.metrics, { timestamp: 42, completedAt: 90 });
  assert.deepEqual(answer?.metrics, { timestamp: 42, completedAt: 90, durationMs: 50 });
  // A message whose timestamp is not a usable instant invents none.
  const odd = transcriptFrom([{ role: "assistant", timestamp: -1, content: [{ type: "thinking", thinking: "Plan" }, { type: "text", text: "Done" }] }]);
  assert.deepEqual(odd[0]?.metrics, undefined, "no timestamp, no metrics object at all");
  assert.deepEqual(odd[1]?.metrics, undefined);
});
