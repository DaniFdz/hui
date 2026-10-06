import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import type { WorkerView } from "../shared/workers.ts";

// Paths are resolved at import time: never the operator's own configuration.
const config = await mkdtemp(join(tmpdir(), "hui-bot-remote-"));
process.env["XDG_CONFIG_HOME"] = config;
after(() => rm(config, { recursive: true, force: true }));
const { remoteBots, reportedStatus } = await import("./bot-remote.ts");
const { BotConflictError, BotInputError, BotWorkerOfflineError } = await import("./bots.ts");
const { BotMemoryUnavailableError } = await import("./bot-memory.ts");
const { WorkerOfflineError } = await import("./workers.ts");
type BotWorkerLink = import("./bot-remote.ts").BotWorkerLink;
type Frame = import("./worker/protocol.ts").Frame;

const STATUS = { messages: 3, built: 1, pending: 0, viewBytes: 120, viewLines: 2, usage: { calls: 1, input: 10, output: 2, cacheRead: 0, cacheWrite: 0, cost: 0 } };

/** A worker service with one worker, devbox (w-1), whose host answers from `replies`. */
function link() {
  const frames = new Set<(id: string, frame: Frame) => void>();
  const closed = new Set<(id: string) => void>();
  const connected = new Set<(id: string) => void>();
  const requests: Array<{ id: string; op: string; params: Record<string, unknown> }> = [];
  const state = { connected: true, features: ["bots"] as string[], replies: new Map<string, (params: Record<string, unknown>) => unknown>() };
  const views = [{ id: "w-1", name: "devbox" }, { id: "w-2", name: "twin" }, { id: "w-3", name: "twin" }].map((worker) => ({ ...worker, command: "ssh x", extraPaths: [], state: "connected" }) as WorkerView);
  const workers: BotWorkerLink = {
    list: async () => views,
    nameOf: (id) => views.find((worker) => worker.id === id)?.name,
    connected: () => state.connected,
    features: () => state.connected ? state.features : undefined,
    hostRequest: async <T>(id: string, op: string, params: Record<string, unknown> = {}) => {
      if (!state.connected) throw new WorkerOfflineError("HUI is not connected to devbox.");
      requests.push({ id, op, params });
      const reply = state.replies.get(op);
      return (reply ? reply(params) : {}) as T;
    },
    onHostFrame: (listener) => { frames.add(listener); return () => frames.delete(listener); },
    onClosed: (listener) => { closed.add(listener); return () => closed.delete(listener); },
    onConnected: (listener) => { connected.add(listener); return () => connected.delete(listener); },
  };
  return {
    workers, state, requests,
    frame: (frame: Frame) => { for (const listener of frames) listener("w-1", frame); },
    close: () => { state.connected = false; for (const listener of closed) listener("w-1"); },
    open: () => { state.connected = true; for (const listener of connected) listener("w-1"); },
  };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

test("a worker's bot ports refuse at once while HUI is not connected, naming the worker, and tell an older host apart", async () => {
  const fake = link();
  const bots = remoteBots(fake.workers);
  fake.state.connected = false;
  await assert.rejects(bots.conversations("w-1").create({ botId: "b", memory: { name: "B" } }),
    (error: unknown) => error instanceof BotWorkerOfflineError && error.message === "HUI is not connected to devbox. Connect it in Settings → Workers, then create the bot again.");
  for (const call of [() => bots.memory("w-1").view("durable:1"), () => bots.conversations("w-1").lastMessage("durable:1"), () => bots.conversations("w-1").removeHome("b")]) {
    await assert.rejects(call(), (error: unknown) => error instanceof BotWorkerOfflineError && /^devbox, where this bot runs, is offline: HUI is not connected to it\./u.test(error.message));
  }
  assert.deepEqual(fake.requests, [], "nothing was sent, and nothing connected");
  fake.state.connected = true;
  fake.state.features = [];
  await assert.rejects(bots.memory("w-1").view("durable:1"), (error: unknown) => error instanceof BotConflictError && /devbox runs an older HUI worker that cannot run bots/u.test(error.message));
  assert.deepEqual(fake.requests, []);
});

test("a worker's bot operations reach its host, and its answers are checked", async () => {
  const fake = link();
  const bots = remoteBots(fake.workers);
  fake.state.replies.set("bot.create", (params) => ({ reference: "durable:7", cwd: params["cwd"] === "~/src" ? "/home/remote/src" : "/home/remote/.local/share/hui-worker/bots/b" }));
  fake.state.replies.set("bot.directory", () => ({ cwd: "/home/remote/src" }));
  fake.state.replies.set("bot.last-message", () => ({ message: { role: "user", text: "hi", at: "2026-10-06T20:00:00.000Z" } }));
  fake.state.replies.set("bot.memory.view", () => ({ unavailable: "This bot's chat has no OptChat memory in this gateway." }));
  fake.state.replies.set("bot.memory.zoom", () => ({ text: "1+0|user: hi" }));
  const conversations = bots.conversations("w-1");
  assert.deepEqual(await conversations.create({ botId: "b", memory: { name: "B" }, cwd: "~/src" }), { reference: "durable:7", cwd: "/home/remote/src" });
  assert.equal(await conversations.directory("~/src"), "/home/remote/src");
  await conversations.configure("durable:7", { instructions: null });
  assert.deepEqual(await conversations.lastMessage("durable:7"), { role: "user", text: "hi", at: "2026-10-06T20:00:00.000Z" });
  await conversations.writeCallRecord("durable:7", { call: "c", startedAt: 1, endedAt: 2, lines: [] });
  await conversations.removeHome("b");
  await bots.memory("w-1").configure("durable:7", { name: "B" });
  assert.equal(await bots.memory("w-1").zoom("durable:7", 1, 1), "1+0|user: hi");
  await assert.rejects(bots.memory("w-1").view("durable:7"), BotMemoryUnavailableError, "the worker's own refusal is the routes' 503");
  assert.deepEqual(fake.requests.map(({ op, params }) => [op, params]), [
    ["bot.create", { botId: "b", memory: { name: "B" }, cwd: "~/src" }],
    ["bot.directory", { cwd: "~/src" }],
    ["bot.configure", { reference: "durable:7", instructions: null }],
    ["bot.last-message", { reference: "durable:7" }],
    ["bot.call-record", { reference: "durable:7", record: { call: "c", startedAt: 1, endedAt: 2, lines: [] } }],
    ["bot.remove-home", { botId: "b" }],
    ["bot.memory.configure", { reference: "durable:7", settings: { name: "B" } }],
    ["bot.memory.zoom", { reference: "durable:7", id: 1, n: 1 }],
    ["bot.memory.view", { reference: "durable:7" }],
  ]);
  fake.state.replies.set("bot.create", () => ({ reference: "/tmp/x.jsonl", cwd: "relative" }));
  await assert.rejects(conversations.create({ botId: "b", memory: { name: "B" } }), /devbox did not create the bot's conversation/u);
  // A connection that goes while a request is out reads as offline.
  fake.state.replies.set("bot.memory.html", () => { fake.state.connected = false; throw new Error("Remote worker connection closed."); });
  await assert.rejects(bots.memory("w-1").html("durable:7"), BotWorkerOfflineError);
});

test("memory status comes from what the worker reports: the first ask watches it, one request for a whole list, and a lost connection forgets it", async () => {
  const fake = link();
  const bots = remoteBots(fake.workers);
  const memory = bots.memory("w-1");
  assert.deepEqual(await Promise.all(["durable:1", "durable:2", "durable:3"].map((reference) => memory.status(reference))), [undefined, undefined, undefined], "nothing reported yet, and nothing awaited");
  await tick();
  assert.deepEqual(fake.requests.map(({ op, params }) => [op, params]), [["bot.memory.watch", { references: ["durable:1", "durable:2", "durable:3"] }]]);
  fake.frame({ t: "bot.memory.status", reference: "durable:2", status: { ...STATUS, waiting: true } });
  fake.frame({ t: "bot.memory.status", reference: "durable:3", status: { messages: "many" } });
  assert.deepEqual(await memory.status("durable:2"), { ...STATUS, waiting: true });
  assert.equal(await memory.status("durable:3"), undefined, "half a status is no status");
  await memory.status("durable:2");
  await tick();
  assert.equal(fake.requests.length, 1, "a watched memory is not asked for again");

  // A view brings the status it counts.
  fake.state.replies.set("bot.memory.view", () => ({ text: "<chat>\n</chat>", status: { ...STATUS, messages: 5 } }));
  await memory.view("durable:4");
  assert.equal((await memory.status("durable:4"))?.messages, 5);

  // Offline, a bot shows no memory; once back, the next ask watches again.
  fake.close();
  assert.equal(await memory.status("durable:2"), undefined);
  fake.open();
  assert.equal(await memory.status("durable:2"), undefined);
  await tick();
  assert.deepEqual(fake.requests.at(-1), { id: "w-1", op: "bot.memory.watch", params: { references: ["durable:2"] } });

  // A live view hears each report; it is watched again after a reconnect.
  const heard: number[] = [];
  const stop = memory.subscribe("durable:9", (status) => heard.push(status.messages));
  await tick();
  fake.frame({ t: "bot.memory.status", reference: "durable:9", status: STATUS });
  assert.deepEqual(heard, [3]);
  fake.close();
  fake.open();
  await tick();
  assert.deepEqual(fake.requests.at(-1)?.params, { references: ["durable:9"] });
  stop();
  fake.frame({ t: "bot.memory.status", reference: "durable:9", status: STATUS });
  assert.deepEqual(heard, [3]);
});

test("a worker is named by its id or a name only it has", async () => {
  const bots = remoteBots(link().workers);
  assert.deepEqual(await bots.find("w-1"), { id: "w-1", name: "devbox" });
  assert.deepEqual(await bots.find(" devbox "), { id: "w-1", name: "devbox" });
  await assert.rejects(bots.find("twin"), (error: unknown) => error instanceof BotInputError && /2 workers are named twin\. Use its id/u.test(error.message));
  await assert.rejects(bots.find("nowhere"), (error: unknown) => error instanceof BotInputError && /No worker named nowhere\. See Settings → Workers\./u.test(error.message));
});

test("only a complete status is reported", () => {
  assert.deepEqual(reportedStatus({ ...STATUS, extra: "internal", failing: { node: "2+1", error: "rate limited", since: "now" } }), { ...STATUS, failing: { node: "2+1", error: "rate limited", since: "now" } });
  assert.equal(reportedStatus({ ...STATUS, usage: undefined }), undefined);
  assert.equal(reportedStatus({ ...STATUS, viewLines: -1 }), undefined);
});
