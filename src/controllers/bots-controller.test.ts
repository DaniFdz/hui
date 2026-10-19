import assert from "node:assert/strict";
import { beforeEach, test, vi } from "vitest";
import type { ReactiveController } from "lit";
import type { BotsStreamHandlers, BotView } from "../lib/bots/bots.ts";
import { DEFAULT_SETTINGS, type Settings } from "../lib/settings.ts";
import { BotsController } from "./bots-controller.ts";

const fake = vi.hoisted(() => ({
  streams: [] as { handlers: BotsStreamHandlers; stopped: boolean }[],
  reads: 0,
  list: [] as BotView[],
  written: [] as (() => void)[],
  refreshed: undefined as Settings | undefined,
}));

vi.mock("../api/bots.ts", () => ({
  subscribeBots: (handlers: BotsStreamHandlers) => {
    const stream = { handlers, stopped: false };
    fake.streams.push(stream);
    return () => { stream.stopped = true; };
  },
  loadBots: async () => { fake.reads += 1; return fake.list; },
}));
vi.mock("../lib/settings/settings-store.ts", () => ({
  settingsWritten: () => new Promise<void>((resolve) => fake.written.push(resolve)),
  refreshSettings: async () => fake.refreshed,
}));

beforeEach(() => {
  fake.streams = [];
  fake.reads = 0;
  fake.list = [];
  fake.written = [];
  fake.refreshed = undefined;
});

const ON: Settings = { ...DEFAULT_SETTINGS, labs: { ...DEFAULT_SETTINGS.labs, bots: true } };
const ADA: BotView = { id: "ada", name: "Ada", sessionId: "s-ada" } as BotView;
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function setup(settings: Settings = ON, embeddedPane = false) {
  const adopted: Settings[] = [];
  const control = { settings, adoptSettings: (next: Settings) => { adopted.push(next); control.settings = next; } };
  const frames: string[] = [];
  const host = {
    embeddedPane,
    updates: 0,
    addController: (_controller: ReactiveController) => {},
    removeController: () => {},
    requestUpdate() { this.updates += 1; },
    updateComplete: Promise.resolve(true),
  };
  const controller = new BotsController(host, {
    control,
    live: (bots) => bots.map((bot) => ({ ...bot, unread: true })),
    onFrame: () => frames.push(controller.list.map((bot) => bot.id).join()),
  });
  return { controller, control, adopted, frames, host };
}

test("no bot stream while Labs → Bots is off, and none in an embedded pane", () => {
  setup({ ...DEFAULT_SETTINGS }).controller.sync();
  setup(ON, true).controller.sync();
  assert.equal(fake.streams.length, 0);
  const { controller, control } = setup();
  controller.sync();
  controller.sync();
  assert.equal(fake.streams.length, 1, "one stream at a time");
  control.settings = { ...DEFAULT_SETTINGS };
  controller.sync();
  assert.equal(fake.streams[0]?.stopped, true, "turned off, it stops at once");
});

test("every new bots frame lands with each bot's live chat state, and tells the shell (the panel's Tools and Triggers follow)", () => {
  const { controller, frames } = setup();
  controller.sync();
  const stream = fake.streams[0]!.handlers;
  stream.onUpdate({ revision: 1, ids: ["ada"], upserts: [ADA] }, true);
  assert.deepEqual(controller.list, [{ ...ADA, unread: true }]);
  assert.equal(controller.loaded, true);
  stream.onUpdate({ revision: 1, upserts: [] }, false);
  assert.deepEqual(frames, ["ada"], "an old frame is dropped");
  stream.onUpdate({ revision: 2, ids: [], upserts: [] }, false);
  assert.deepEqual(frames, ["ada", ""], "on every bots frame");
});

test("a 409 reads the settings again once this screen's writes landed; still on, the stream is asked once more, never in a loop", async () => {
  const { controller, adopted } = setup();
  controller.sync();
  fake.refreshed = ON;
  fake.streams[0]!.handlers.onConnection("off");
  assert.equal(adopted.length, 0, "waits for this screen's own writes");
  fake.written.shift()!();
  await settle();
  assert.deepEqual(adopted, [ON]);
  assert.equal(fake.streams.length, 2, "asked once more");
  fake.streams[1]!.handlers.onConnection("off");
  fake.written.shift()!();
  await settle();
  assert.equal(fake.streams.length, 2, "never in a loop");
  controller.retry();
  fake.streams[2]!.handlers.onConnection("live");
  fake.streams[2]!.handlers.onConnection("off");
  fake.written.shift()!();
  await settle();
  assert.equal(fake.streams.length, 4, "a live stream may be asked again after its next 409");
});

test("a 409 whose settings say bots are off does not ask again", async () => {
  const { controller, adopted } = setup();
  controller.sync();
  fake.refreshed = { ...DEFAULT_SETTINGS };
  fake.streams[0]!.handlers.onConnection("off");
  fake.written.shift()!();
  await settle();
  assert.deepEqual(adopted, [fake.refreshed]);
  assert.equal(fake.streams.length, 1);
});

test("a gateway without the stream falls back to one read at a time, and a live stream skips reads", async () => {
  const { controller } = setup();
  controller.sync();
  fake.list = [ADA];
  fake.streams[0]!.handlers.onConnection("unsupported");
  const again = controller.refresh();
  assert.equal(controller.loading, true);
  await again;
  assert.equal(fake.reads, 2, "a change that lands meanwhile reads once more after it");
  assert.deepEqual(controller.list, [{ ...ADA, unread: true }]);
  assert.equal(controller.loading, false);
  controller.ensure();
  await settle();
  assert.equal(fake.reads, 3, "without the stream, the list is read when asked for");
  assert.equal(fake.streams.length, 1);

  const live = setup();
  live.controller.sync();
  fake.streams[1]!.handlers.onConnection("live");
  await live.controller.refresh();
  assert.equal(fake.reads, 3);
});

test("before the first list, a reconnecting stream says so, and a stopped stream restarts on retry", () => {
  const { controller } = setup();
  controller.sync();
  fake.streams[0]!.handlers.onConnection("reconnecting");
  assert.equal(controller.error, "Could not reach the gateway for the bot list. Retrying…");
  controller.retry();
  assert.equal(controller.error, "");
  assert.equal(fake.streams[0]!.stopped, true);
  assert.equal(fake.streams.length, 2);
});

test("disconnecting stops the stream", () => {
  const { controller } = setup();
  controller.sync();
  fake.streams[0]!.handlers.onConnection("live");
  controller.hostDisconnected();
  assert.equal(fake.streams[0]!.stopped, true);
  assert.equal(controller.streamLive, false);
});
