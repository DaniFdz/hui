import assert from "node:assert/strict";
import test from "node:test";
import { createWorkerRoutes } from "./worker-routes.ts";
import type { SessionRecord } from "./sessions.ts";
import type { WorkerService } from "./workers.ts";
import type { WorkerBot } from "../shared/workers.ts";

const WORKER = "11111111-2222-4333-8444-555555555555";

test("creating a bot registers one session even when the host announces it first", async () => {
  let records: SessionRecord[] = [];
  const accepted: string[] = [];
  const deps = {
    readRegistry: async () => records,
    updateRegistry: async (update: (current: SessionRecord[]) => SessionRecord[]) => { records = update(records); },
    sessions: { accept: (id: string) => accepted.push(id), ensure: () => undefined, isLive: () => false },
    deleteSession: async () => undefined,
  };
  let routes: ReturnType<typeof createWorkerRoutes>;
  const service = {
    // The host's bot list arrives before the save reply, as it does over SSH.
    saveBot: async (_id: string, key: string, input: { name: string; cwd: string; prompt: string }) => {
      const bot: WorkerBot = { key, ...input, instructions: "", schedule: null, enabled: true, timeoutSeconds: 1800, nextRunAt: null, createdAt: "", updatedAt: "", runs: [] };
      await routes.onBots(WORKER, [bot]);
      return bot;
    },
    deleteBot: async () => true,
  } as unknown as WorkerService;
  routes = createWorkerRoutes({ ...deps, service, updateRegistry: deps.updateRegistry as never });
  const result = await routes.handle("POST", `/__hui/workers/${WORKER}/bots`, async () => ({ name: "Watcher", cwd: "~/project", prompt: "Check in." }));
  assert.equal(result?.status, 201);
  const key = (result?.body as { bot: WorkerBot }).bot.key;
  assert.deepEqual(records.map((record) => [record.id, record.worker, record.bot, record.group]), [[key, WORKER, true, "Bots"]]);
});
