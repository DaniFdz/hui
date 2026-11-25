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
  assert.equal(entries[0]?.metrics, undefined);
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
  assert.equal(entries[0]?.metrics, undefined);
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
