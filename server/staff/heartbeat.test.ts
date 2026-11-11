/** Every live Chief of Staff gets one Heartbeat routine; an existing one, a normal bot and an archived chief do not. */
import assert from "node:assert/strict";
import { test } from "vitest";
import type { AutomationTask, AutomationTaskInput } from "../automation.ts";
import type { BotView } from "../api/bots.ts";
import { ensureChiefHeartbeats, HEARTBEAT_INTERVAL_MS, HEARTBEAT_ROUTINE_NAME } from "./heartbeat.ts";

const bot = (id: string, title: string, archived = false) => ({ id, title, archived, sessionId: `session-${id}` } as BotView);

test("adds the Heartbeat routine to every live Chief of Staff exactly once", async () => {
  const created: AutomationTaskInput[] = [];
  const tasks = [{ name: HEARTBEAT_ROUTINE_NAME, sessionId: "session-default" } as AutomationTask];
  const result = await ensureChiefHeartbeats({
    bots: { list: async () => [bot("default", "Chief of Staff"), bot("group", "Chief of Staff · critical path"), bot("normal", "Reviewer"), bot("gone", "Chief of Staff · archived", true)] },
    automation: {
      snapshot: async () => ({ tasks } as never),
      create: async (task: AutomationTaskInput) => { created.push(task); return {} as AutomationTask; },
    },
  });
  assert.deepEqual(result, { created: ["group"], existing: ["default"] });
  assert.equal(created.length, 1);
  assert.equal(created[0]?.sessionId, "session-group");
  assert.equal(created[0]?.name, HEARTBEAT_ROUTINE_NAME);
  assert.deepEqual(created[0]?.schedule, { kind: "every", everyMs: HEARTBEAT_INTERVAL_MS });
  assert.match(created[0]?.prompt ?? "", /watch_session list/u);
  assert.match(created[0]?.prompt ?? "", /Never create a session/u);
});

test("a second pass creates nothing", async () => {
  const created: AutomationTaskInput[] = [];
  const result = await ensureChiefHeartbeats({
    bots: { list: async () => [bot("group", "Chief of Staff · critical path")] },
    automation: {
      snapshot: async () => ({ tasks: [{ name: HEARTBEAT_ROUTINE_NAME, sessionId: "session-group" }] } as never),
      create: async (task: AutomationTaskInput) => { created.push(task); return {} as AutomationTask; },
    },
  });
  assert.deepEqual(result, { created: [], existing: ["group"] });
  assert.equal(created.length, 0);
});
