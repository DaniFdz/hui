import assert from "node:assert/strict";
import { test } from "vitest";

import { decodeSseFrame, reconnectDelay } from "./event-stream.ts";

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

test("an SSE frame joins its data lines and skips comments", () => {
  assert.deepEqual(decodeSseFrame(': heartbeat\nevent: status\ndata: {"id":\ndata:"a"}'), { name: "status", payload: { id: "a" } });
  assert.deepEqual(decodeSseFrame("data: [1]"), { name: "message", payload: [1] });
  assert.equal(decodeSseFrame(": heartbeat\nevent: status"), undefined);
});
