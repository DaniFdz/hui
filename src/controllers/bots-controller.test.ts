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
  patches: [] as { id: string; patch: Record<string, unknown>; answer: (outcome: BotView | Error) => void }[],
}));

vi.mock("../api/bots.ts", () => ({
  subscribeBots: (handlers: BotsStreamHandlers) => {
    const stream = { handlers, stopped: false };
    fake.streams.push(stream);
    return () => { stream.stopped = true; };
  },
  loadBots: async () => { fake.reads += 1; return fake.list; },
  updateBot: (id: string, patch: Record<string, unknown>) => new Promise<BotView>((resolve, reject) => {
    fake.patches.push({ id, patch, answer: (outcome) => outcome instanceof Error ? reject(outcome) : resolve(outcome) });
  }),
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
  fake.patches = [];
  const stored = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => stored.set(key, value) });
});

const ON: Settings = { ...DEFAULT_SETTINGS, labs: { ...DEFAULT_SETTINGS.labs, bots: true } };
const ADA: BotView = { id: "ada", name: "Ada", sessionId: "s-ada", cwd: "/work" } as BotView;
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

test("the Agents | Bots choice and the panel's open state and width are remembered by the browser; the rest is not", () => {
  const { controller, host } = setup();
  assert.equal(controller.tab, "sessions");
  assert.equal(controller.selectTab("bots"), true);
  assert.equal(controller.selectTab("bots"), false, "already showing");
  assert.equal(localStorage.getItem("hui.sidebar-tab"), "bots");
  controller.closePanel(false);
  controller.resizePanel(420);
  const width = controller.panel.width;
  controller.openPanel(false);
  assert.deepEqual(JSON.parse(localStorage.getItem("hui.bot-panel")!), { open: true, width }, "docked, it opens at the width it had");
  const next = setup().controller;
  assert.equal(next.tab, "bots");
  assert.deepEqual(next.panel, { open: true, width });
  controller.openPanel(true);
  controller.expandPanel(true);
  assert.equal(controller.sheetOpen, true, "the sheet on narrow screens");
  assert.equal(next.sheetOpen || next.panelExpanded, false, "never remembered");
  assert.ok(host.updates > 0);
});

test("toggling or closing the docked panel ends its expanded view; a sheet keeps the docked state", () => {
  const { controller } = setup();
  controller.expandPanel(true);
  controller.togglePanel(false);
  assert.equal(controller.panel.open, false);
  assert.equal(controller.panelExpanded, false);
  controller.togglePanel(true);
  assert.equal(controller.sheetOpen, true);
  assert.equal(controller.panel.open, false);
  controller.expandPanel(true);
  controller.closePanel(true);
  assert.equal(controller.sheetOpen, false);
  assert.equal(controller.panelExpanded, false);
  controller.togglePanel(true);
  controller.closeSheet();
  assert.equal(controller.sheetOpen, false);
});

test("a page opened from an overview row goes back to that row, and another bot opens on its overview, docked", () => {
  const { controller } = setup();
  assert.equal(controller.showPanelView("tools", "setup-tools"), "setup-tools");
  assert.equal(controller.panelView, "tools");
  assert.equal(controller.showPanelView("overview"), "setup-tools", "back to the row that opened it");
  assert.equal(controller.panelOpenedFrom, "");
  controller.showPanelView("settings", "settings-model");
  controller.openPanel(true);
  controller.expandPanel(true);
  controller.resetPanel();
  assert.deepEqual([controller.panelView, controller.panelOpenedFrom, controller.sheetOpen, controller.panelExpanded], ["overview", "", false, false]);
});

test("each Settings change shows as saving at once and is one PATCH, sent in order; a newer value replaces one still waiting", async () => {
  const { controller } = setup();
  controller.adopt([ADA]);
  controller.changeSetting("ada", "name", "Grace");
  controller.changeSetting("ada", "title", "Pilot");
  controller.changeSetting("ada", "title", "Captain");
  assert.deepEqual(controller.savesOf("ada").pending, { name: "Grace", title: "Captain" });
  await settle();
  assert.deepEqual(fake.patches.map(({ id, patch }) => [id, patch]), [["ada", { name: "Grace" }]], "one at a time");
  fake.patches[0]!.answer({ ...ADA, name: "Grace" });
  await settle();
  assert.deepEqual(controller.list, [{ ...ADA, name: "Grace" }], "the gateway's answer replaces the bot");
  assert.deepEqual(fake.patches.map(({ patch }) => patch), [{ name: "Grace" }, { title: "Captain" }], "the newest value, sent once");
  fake.patches[1]!.answer(new Error("Too long."));
  await settle();
  assert.deepEqual(controller.savesOf("ada"), { pending: {}, errors: { title: "Too long." } }, "a refusal stays on its row");
  controller.dismissSetting("ada", "title");
  assert.deepEqual(controller.savesOf("ada"), { pending: {}, errors: {} });
  controller.changeSetting("gone", "name", "X");
  await settle();
  assert.deepEqual(controller.savesOf("gone").errors, { name: "This bot is gone." });
  assert.equal(fake.patches.length, 2);
});
