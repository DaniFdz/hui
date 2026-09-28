import assert from "node:assert/strict";
import test from "node:test";
import { formatElapsed, subagentElapsed, subagentVisualState } from "./subagent-activity.ts";

test("formatElapsed matches OpenClaw duration style", () => {
  assert.equal(formatElapsed(6_400), "6s");
  assert.equal(formatElapsed(0), "0s");
  assert.equal(formatElapsed(-5), "0s");
  assert.equal(formatElapsed((34 * 60 + 25) * 1000), "34m 25s");
  assert.equal(formatElapsed(5 * 60_000), "5m");
  assert.equal(formatElapsed((62 * 60 + 9) * 1000), "1h 2m");
  assert.equal(formatElapsed(2 * 3_600_000), "2h");
});

test("subagentElapsed uses endedAt when finished and now while running", () => {
  const startedAt = "2026-09-25T09:00:00.000Z";
  assert.equal(subagentElapsed({ status: "completed", startedAt, endedAt: "2026-09-25T09:00:06.000Z" }), "6s");
  assert.equal(subagentElapsed({ status: "running", startedAt, endedAt: "2026-09-25T09:00:06.000Z" }, Date.parse("2026-09-25T09:01:30.000Z")), "1m 30s");
  assert.equal(subagentElapsed({ status: "failed", startedAt, updatedAt: "2026-09-25T09:00:10.000Z" }), "10s");
  assert.equal(subagentElapsed({ status: "completed", startedAt: "nope" }), undefined);
});

test("subagentVisualState collapses terminal failures", () => {
  assert.equal(subagentVisualState("starting"), "running");
  assert.equal(subagentVisualState("completed"), "completed");
  assert.equal(subagentVisualState("timed_out"), "failed");
  assert.equal(subagentVisualState("interrupted"), "failed");
  assert.equal(subagentVisualState("cancelled"), "cancelled");
});
