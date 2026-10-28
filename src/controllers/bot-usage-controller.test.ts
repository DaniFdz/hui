/** The overview's cost reads again when the bot's chat changes state, and never shows another bot's. */
import assert from "node:assert/strict";
import { test } from "vitest";
import type { UsageTotals } from "../api/schema/diagnostics.ts";
import { BotUsageController } from "./bot-usage-controller.ts";

const usage = (costUsd: number): UsageTotals => ({
  sessions: 1, filesRead: 1, records: 1, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0,
  costUsd, models: [{ model: "m", tokens: 1, costUsd }], unavailable: [],
});

test("reads once per state of the chat, keeps the last cost when a read fails and tries again", async () => {
  const reads: string[] = [];
  let fail = false;
  const controller = new BotUsageController({ requestUpdate() {} }, async (id) => {
    reads.push(id);
    if (fail) throw new Error("offline");
    return usage(reads.length);
  });
  await controller.show({ id: "a", status: "idle" });
  await controller.show({ id: "a", status: "idle" });
  assert.deepEqual(reads, ["a"]);
  fail = true;
  await controller.show({ id: "a", status: "running" });
  assert.equal(controller.state.usage?.costUsd, 1);
  assert.equal(controller.state.error, "offline");
  fail = false;
  await controller.show({ id: "a", status: "running" });
  assert.equal(controller.state.usage?.costUsd, 3);
  assert.equal(controller.state.error, "");
});

test("a slow read of one bot never lands on another's overview", async () => {
  let finish: (value: UsageTotals) => void = () => {};
  const controller = new BotUsageController({ requestUpdate() {} }, async (id) => id === "a" ? new Promise((resolve) => { finish = resolve; }) : usage(2));
  const slow = controller.show({ id: "a", status: "idle" });
  await controller.show({ id: "b", status: "idle" });
  finish(usage(1));
  await slow;
  assert.equal(controller.state.botId, "b");
  assert.equal(controller.state.usage?.costUsd, 2);
});
