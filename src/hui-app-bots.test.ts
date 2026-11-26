/** Bot and settings coordination through the real shell's callbacks, navigation and rendered view props. */
import assert from "node:assert/strict";
import { beforeEach, test, vi } from "vitest";
import { HuiApp } from "./hui-app.ts";
import * as botApi from "./api/bots.ts";
import * as templatesApi from "./api/bot-templates.ts";
import type { BotExportReview, BotImportPreview } from "./api/schema/bot-templates.ts";
import * as botViews from "./views/bots.ts";
import type { BotView } from "./lib/bots/bots.ts";
import type { SessionView } from "./api/sessions.ts";

const BOT = {
  id: "ada", name: "Ada", handle: "ada", sessionId: "s-ada", cwd: "/work", status: "idle", soul: false, routines: 0,
} as BotView;
const SESSION = { id: "s-ada", title: "Ada", cwd: "/work", status: "idle", bot: { id: "ada", name: "Ada", handle: "ada" } } as SessionView;

beforeEach(() => {
  const stored = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => stored.set(key, value) });
  vi.stubGlobal("document", { querySelector: () => null, querySelectorAll: () => [], activeElement: null });
  vi.stubGlobal("HTMLDialogElement", class {});
  vi.stubGlobal("HTMLButtonElement", class {});
  vi.stubGlobal("HTMLElement", class {});
});

function setup() {
  const app = new HuiApp();
  Object.defineProperty(app, "renderRoot", { value: { querySelector: () => null } });
  Object.defineProperty(app, "updateComplete", { value: Promise.resolve(true) });
  app["bots"].adopt([BOT]);
  app["bots"].loaded = true;
  app["sessions"].groups = [{ label: "g1", sessions: [SESSION] }];
  vi.spyOn(app["bots"], "sync").mockImplementation(() => {});
  vi.spyOn(app["launcher"], "loadWorkers").mockImplementation(() => {});
  vi.spyOn(app["automation"], "load").mockImplementation(() => {});
  vi.spyOn(app["automation"], "startPolling").mockImplementation(() => {});
  vi.spyOn(app["automation"], "stopPolling").mockImplementation(() => {});
  vi.spyOn(app["botTriggers"], "sync").mockImplementation(() => {});
  app["loadLaunchPreferences"] = vi.fn();
  app["resetSessionEphemeral"] = vi.fn();
  app["loadSettingsData"] = vi.fn();
  app["clearSessionState"] = vi.fn();
  app["navigate"] = vi.fn();
  return app;
}

function binding(value: unknown, name: string): unknown {
  if (!value || typeof value !== "object") return undefined;
  if ("strings" in value && "values" in value) {
    const template = value as { strings: readonly string[]; values: unknown[] };
    const index = template.strings.findIndex((part) => part.endsWith(`${name}=`));
    if (index >= 0) return template.values[index];
    return template.values.map((item) => binding(item, name)).find((item) => item !== undefined);
  }
  if ("_$litDirective$" in value && "values" in value) {
    return (value.values as unknown[]).map((item) => binding(item, name)).find((item) => item !== undefined);
  }
  return undefined;
}

function workspace(app: HuiApp) {
  app["view"] = "bot";
  app["activeBotId"] = BOT.id;
  app["bots"].panel = { open: true, width: 400 };
  const panel = vi.spyOn(botViews, "renderBotPanel");
  const template = app["renderBotWorkspace"]();
  const props = panel.mock.calls.at(-1)?.[0];
  assert.ok(props, "the open bot renders its panel");
  return { template, props };
}

test("the Agents list always excludes bot chats, and the sidebar keeps the chosen tab", () => {
  const app = setup();
  app["bots"].selectTab("bots");
  const normal = { id: "normal", title: "Work" } as SessionView;
  app["sessions"].groups = [{ label: "g1", sessions: [SESSION, normal] }];
  assert.equal(app["shellBotsProps"]().tab, "bots");
  assert.deepEqual(app["listedGroups"][0]?.sessions, [normal]);
  assert.equal(localStorage.getItem("hui.sidebar-tab"), "bots");
});

test("session links open the bot, and an embedded pane sends a bot route home", () => {
  const app = setup();
  app["pendingSessionId"] = SESSION.id;
  app["openPendingSession"]();
  assert.deepEqual(vi.mocked(app["navigate"]).mock.calls.at(-1), [{ kind: "bot", id: BOT.id }, true]);
  app.embeddedPane = true;
  app["applyNavigation"]({ kind: "bot", id: BOT.id });
  assert.deepEqual(vi.mocked(app["navigate"]).mock.calls.at(-1), [{ kind: "home" }, true]);
});

test("the sidebar and empty roster create immediately on the selected machine, and Import and Export use the shared dialogs", () => {
  const app = setup();
  const create = vi.spyOn(app["bots"], "create").mockImplementation(() => {});
  const exportBot = vi.spyOn(app["botImports"], "openExport").mockImplementation(() => {});
  const workers = [{ id: "w1", name: "Box", state: "connected" as const, command: "ssh box", extraPaths: [] }];
  app["launcher"].workers = workers;
  const props = app["shellBotsProps"]()!;
  assert.equal(props.workers, workers);
  props.onNew();
  props.onCreate("w1");
  props.roster.onNew();
  assert.deepEqual(create.mock.calls, [[undefined], ["w1"], [undefined]]);
  props.onWorkersMenu?.();
  assert.equal(vi.mocked(app["launcher"].loadWorkers).mock.calls.length, 1);
  app["bots"].creating = true;
  assert.equal(app["shellBotsProps"]().creating, true);
  assert.equal(app["shellBotsProps"]().roster.creating, true);
  props.onImport();
  assert.equal(app["botImports"].importing, true);
  app["botImports"].close();
  props.roster.onImport();
  assert.equal(app["botImports"].importing, true);
  app["botMenuFor"] = BOT.id;
  props.roster.onExport(BOT);
  assert.deepEqual(exportBot.mock.calls, [[BOT]]);
  assert.equal(app["botMenuFor"], "");
});

test("import creates only after preview and opens the imported bot through the bots controller", async () => {
  const app = setup();
  const template = { format: "text" as const, name: "Ada", soul: "Help out", memories: [], skills: [], routines: [], integrations: [], dropped: [], notes: [] };
  const preview: BotImportPreview = {
    template, bot: { name: "Ada", handle: "ada" }, soul: "Help out", memory: "", memories: { included: 0, total: 0 },
    skills: [], routines: [], integrations: [], disabledTools: [], disabledSkills: [], open: [], needs: [], triggers: [], dropped: [], notes: [],
  };
  vi.spyOn(templatesApi, "previewBotImport").mockResolvedValue(preview);
  const create = vi.spyOn(templatesApi, "importBot").mockResolvedValue({ bot: BOT, warnings: ["Routines paused."], skills: [], routines: 0, opener: false });
  const imported = vi.spyOn(app["bots"], "imported").mockImplementation(() => {});
  app["shellBotsProps"]().onImport();
  app["botImports"].importProps()!.onCreate();
  assert.equal(create.mock.calls.length, 0, "no create before a preview");
  app["botImports"].importProps()!.onTab("paste");
  app["botImports"].importProps()!.onText("Help out");
  app["botImports"].importProps()!.onPreview();
  await Promise.resolve();
  assert.equal(app["botImports"].importProps()?.step, "preview");
  assert.equal(create.mock.calls.length, 0, "preview creates nothing");
  app["botImports"].importProps()!.onCreate();
  await Promise.resolve();
  assert.deepEqual(create.mock.calls, [[template, undefined]]);
  assert.deepEqual(imported.mock.calls, [[BOT, ["Routines paused."]]]);
  assert.equal(app["botImports"].importing, false);
});

test("Download sends the review id, picks and added passages; a stale review offers another review", async () => {
  const app = setup();
  const review: BotExportReview = {
    id: "review-1", botId: BOT.id, name: BOT.name, cleanup: [], changes: [], files: [], needs: [], leftOut: [],
    parts: [{ id: "SOUL.md", label: "Instructions", kind: "text", fields: [{ key: "soul", text: "Help out on Monday." }], read: true }],
    meta: { routines: [], triggers: [], disabledTools: [], disabledSkills: [], skills: [] },
  };
  const read = vi.spyOn(templatesApi, "reviewBotExport").mockResolvedValue(review);
  const download = vi.spyOn(templatesApi, "downloadBotExport").mockRejectedValue(new templatesApi.BotExportError("Review expired.", 409));
  app["shellBotsProps"]().roster.onExport(BOT);
  await Promise.resolve();
  app["botImports"].exportProps()!.onPick("change-1", "remove");
  app["botImports"].exportProps()!.onDraft({ quote: "Monday", group: "confirm" });
  app["botImports"].exportProps()!.onAdd();
  app["botImports"].exportProps()!.onDownload();
  await Promise.resolve();
  assert.deepEqual(download.mock.calls[0]?.slice(0, 2), [BOT.id, { review: "review-1", picks: { "change-1": "remove" }, added: [{ quote: "Monday", group: "confirm" }] }]);
  assert.equal(app["botImports"].exportProps()?.stale, true);
  assert.equal(app["botImports"].exportProps()?.error, "Review expired.");
  app["botImports"].exportProps()!.onReview();
  await Promise.resolve();
  assert.deepEqual(read.mock.calls, [[BOT.id], [BOT.id]]);
  assert.equal(app["botImports"].exportProps()?.stale, false);
});

test("Edit opens Settings docked or in a sheet, and the shortcut toggles it only on an unobstructed bot chat", () => {
  for (const mobile of [false, true]) {
    const app = setup();
    app["mobileNavLayout"] = mobile;
    app["navigate"] = vi.fn((target) => app["applyNavigation"](target));
    app["shellBotsProps"]().roster.onEdit(BOT);
    assert.equal(app["view"], "bot");
    assert.equal(app["activeBotId"], BOT.id);
    assert.equal(app["bots"].panelView, "settings");
    assert.equal(mobile ? app["bots"].sheetOpen : app["bots"].panel.open, true);
    const apple = /Mac|iPhone|iPad|iPod/u.test(navigator.platform);
    const shortcut = () => ({ key: ",", code: "Comma", ctrlKey: !apple, metaKey: apple, shiftKey: true, preventDefault: vi.fn() }) as unknown as KeyboardEvent;
    app["onGlobalKeyDown"](shortcut());
    assert.equal(mobile ? app["bots"].sheetOpen : app["bots"].panel.open, false);
    app["onGlobalKeyDown"](shortcut());
    assert.equal(app["bots"].panelView, "settings");
    for (const blocked of ["settingsOpen", "commandPaletteOpen"] as const) {
      app[blocked] = true;
      const event = shortcut();
      app["onGlobalKeyDown"](event);
      assert.equal(vi.mocked(event.preventDefault).mock.calls.length, 0);
      app[blocked] = false;
    }
    vi.stubGlobal("document", { querySelector: () => ({ open: true }) });
    const event = shortcut();
    app["onGlobalKeyDown"](event);
    assert.equal(vi.mocked(event.preventDefault).mock.calls.length, 0);
    vi.stubGlobal("document", { querySelector: () => null });
  }
});

test("a different bot resets its panel, tools and triggers; opening Tools reads its catalog and bot frames follow the visible page", () => {
  const app = setup();
  const resetTools = vi.spyOn(app["botTools"], "reset");
  const resetTriggers = vi.spyOn(app["botTriggers"], "reset");
  const refresh = vi.spyOn(app["botTools"], "refresh").mockResolvedValue();
  const followTools = vi.spyOn(app["botTools"], "follow").mockImplementation(() => {});
  const followTriggers = vi.spyOn(app["botTriggers"], "follow").mockImplementation(() => {});
  app["bots"].showPanelView("settings");
  app["bots"].expandPanel(true);
  app["bots"].togglePanelWork();
  app["applyNavigation"]({ kind: "bot", id: BOT.id });
  assert.deepEqual([app["bots"].panelView, app["bots"].panelExpanded, app["bots"].panelWorkExpanded], ["overview", false, false], "another bot folds the Work queue back");
  assert.deepEqual(resetTools.mock.calls, [[BOT.id]]);
  assert.deepEqual(resetTriggers.mock.calls, [[BOT.id]]);
  assert.equal(app["botTriggersVisible"](), true);
  app["selectBotPanelView"]("tools");
  assert.deepEqual(refresh.mock.calls, [[BOT]]);
  assert.equal(app["botTriggersVisible"](), false);
  let handlers: Parameters<typeof botApi.subscribeBots>[0] | undefined;
  vi.spyOn(botApi, "subscribeBots").mockImplementation((next) => { handlers = next; return () => {}; });
  vi.mocked(app["bots"].sync).mockRestore();
  app["bots"].sync();
  handlers!.onUpdate({ revision: 1, ids: [BOT.id], upserts: [BOT] }, true);
  assert.deepEqual(followTools.mock.calls, [[BOT]]);
  assert.equal(followTriggers.mock.calls.length, 0);
  app["selectBotPanelView"]("triggers", "triggers-add");
  handlers!.onUpdate({ revision: 2, ids: [BOT.id], upserts: [BOT] }, false);
  assert.deepEqual(followTriggers.mock.calls, [[BOT]]);
  assert.deepEqual(vi.mocked(app["botTriggers"].sync).mock.calls.at(-1), [BOT]);
  const { props } = workspace(app);
  assert.equal(props.tools.state, app["botTools"].props(BOT).state);
  assert.equal(props.triggers.state, app["botTriggers"].props(BOT).state);
});

test("the bot panel saves each setting through its controller and only offers folders on the bot's machine", () => {
  const app = setup();
  const remote = { ...BOT, worker: { id: "w1", name: "Box" } };
  app["bots"].adopt([remote]);
  app["launcher"].workers = [{ id: "w1", name: "Box", state: "connected", command: "ssh box", extraPaths: [] }];
  app["launcher"].directorySuggestions = ["/box/project"];
  app["launcher"].directorySuggestionsFrom = "";
  const save = vi.spyOn(app["bots"], "changeSetting").mockImplementation(() => {});
  const directories = vi.spyOn(app["launcher"], "loadDirectorySuggestions").mockImplementation(() => {});
  let { props } = workspace(app);
  assert.deepEqual(props.settings.directory.suggestions, []);
  assert.equal(props.settings.workersExist, true);
  props.settings.directory.onInput("/box");
  assert.deepEqual(directories.mock.calls, [["/box", "w1"]]);
  props.settings.onChange("name", "Grace");
  assert.deepEqual(save.mock.calls, [[BOT.id, "name", "Grace"]]);
  assert.deepEqual(props.settings.call, app["bots"].settingsCall());
  app["launcher"].directorySuggestionsFrom = "w1";
  ({ props } = workspace(app));
  assert.deepEqual(props.settings.directory.suggestions, ["/box/project"]);
});

test("chat header actions use the same Edit, Archive and Delete paths as the roster", () => {
  const app = setup();
  const { template } = workspace(app);
  const action = binding(template, ".onPaneBotAction");
  assert.ok(typeof action === "function");
  app["openEditBot"] = vi.fn();
  action("edit");
  assert.deepEqual(vi.mocked(app["openEditBot"]).mock.calls, [[BOT]]);
  action("archive");
  assert.equal(app["bots"].archiving, BOT);
  action("delete");
  assert.equal(app["bots"].deleting, BOT);
});

test("a bot offers calls once the gateway reports a ChatGPT login, and a call already in progress remains reachable", () => {
  const app = setup();
  const status = vi.spyOn(app["bots"], "loadCallsStatus").mockResolvedValue();
  workspace(app);
  app.updated(new Map());
  assert.equal(status.mock.calls.length, 1);
  const unavailable = workspace(app).template;
  assert.equal(binding(unavailable, ".paneCall"), undefined);
  assert.equal(binding(unavailable, ".paneVoice"), undefined);
  app["bots"].callsStatus = { model: "live", voices: [], active: 0, limit: 1, chatgpt: { signedIn: true } };
  assert.deepEqual(binding(workspace(app).template, ".paneCall"), { botId: BOT.id, inCall: false });
  app["bots"].callsStatus = { model: "live", voices: [], active: 0, limit: 1, chatgpt: { signedIn: false } };
  Object.defineProperty(app["voice"], "call", { get: () => ({ bot: BOT, minimized: true, state: { phase: "listening" } }) });
  assert.deepEqual(binding(workspace(app).template, ".paneCall"), { botId: BOT.id, inCall: true });
});

test("the call's face follows the voice while speaking and the microphone otherwise", () => {
  const app = setup();
  vi.spyOn(app["voice"], "voiceLevel").mockReturnValue(0.9);
  vi.spyOn(app["voice"], "micLevel").mockReturnValue(0.3);
  for (const phase of ["speaking", "listening", "connecting"] as const) {
    const call = { bot: BOT, minimized: false, state: { phase, startedAt: 0, micMuted: false, speakerMuted: false, delegating: 0, you: "", bot: "" } };
    Object.defineProperty(app["voice"], "call", { configurable: true, get: () => call });
    assert.equal(app["callViewProps"](BOT, call).level?.(), phase === "speaking" ? 0.9 : 0.3);
  }
});

test("Escape restores an expanded bot chat before forwarding Escape to that chat", () => {
  const app = setup();
  workspace(app);
  app["bots"].expandPanel(true);
  assert.equal(binding(app["renderBotWorkspace"](), ".paneSession"), SESSION, "expanding keeps the chat's session mounted");
  const forward = vi.fn();
  app["botPaneApp"] = () => ({ handleGlobalEscape: forward }) as unknown as HuiApp;
  const event = { preventDefault: vi.fn(), composedPath: () => [] } as unknown as KeyboardEvent;
  app["handleGlobalEscape"](event);
  assert.equal(app["bots"].panelExpanded, false);
  assert.equal(forward.mock.calls.length, 0);
  app["handleGlobalEscape"](event);
  assert.equal(forward.mock.calls.length, 1);
});

test("automation receives all sessions and controller state, and navigation starts and stops its polling", () => {
  const app = setup();
  app["sessions"].groups = [...app["sessions"].groups, { label: "g2", sessions: [{ ...SESSION, id: "second" }] }];
  app["automation"].actionError = "Refused.";
  const props = app["automationProps"]();
  assert.deepEqual(props.sessions.map(({ id }) => id), ["s-ada", "second"]);
  assert.equal(props.automationActionError, "Refused.");
  props.onRetryAutomation();
  assert.equal(vi.mocked(app["automation"].load).mock.calls.length, 1);
  app["applyNavigation"]({ kind: "settings", page: "automation" });
  assert.equal(vi.mocked(app["automation"].startPolling).mock.calls.length, 1);
  app["applyNavigation"]({ kind: "settings", page: "appearance" });
  app["applyNavigation"]({ kind: "home" });
  assert.equal(vi.mocked(app["automation"].stopPolling).mock.calls.length, 2);
});


/* ── a bot's own work ─────────────────────────────────────────────────────── */

const started = (id: string, status: SessionView["status"]): SessionView => ({
  id, title: id, group: "g1", cwd: "/work", displayCwd: "/work", tool: "durable", status, stage: "investigation", stageOrigin: "default",
  createdAt: "2026-11-20T09:00:00.000Z", updatedAt: "2026-11-20T09:00:00.000Z", createdBy: { id: BOT.id, handle: BOT.handle, name: BOT.name },
} as SessionView);

test("the Bots tab and the bot's panel read one work projection per registry, with the same counts", () => {
  const app = setup();
  app["bots"].selectTab("bots");
  app["sessions"].groups = [{ label: "g1", sessions: [SESSION, started("s-wait", "waiting"), started("s-run", "running")] }];
  const roster = app["shellBotsProps"]().roster;
  const queue = roster.work?.get(BOT.id);
  assert.deepEqual(queue?.counts, { "needs-you": 1, working: 1, recent: 0 });
  assert.equal(queue?.inFlight, 2);
  assert.equal(app["shellBotsProps"]().roster.work?.get(BOT.id), queue, "a second frame reuses the same projection");
  const { props } = workspace(app);
  assert.equal(props.work.queue, queue, "the panel draws the roster's projection, not its own pass");
  // A new registry projection is walked once, for its own queues.
  app["sessions"].groups = [{ label: "g1", sessions: [SESSION, started("s-wait", "waiting"), started("s-run", "running")] }];
  const reread = app["shellBotsProps"]().roster.work?.get(BOT.id);
  assert.notEqual(reread, queue);
  assert.deepEqual(reread?.counts, queue?.counts);
  // Off the Bots tab the shell walks nothing for the roster.
  app["bots"].selectTab("sessions");
  assert.equal(app["shellBotsProps"]().roster.work, undefined);
  // The bot's own chat reads the same started index: one walk of a registry projection, never one per reader.
  app["bots"].selectTab("bots");
  let createdByReads = 0;
  const counted = started("s-counted", "waiting");
  Object.defineProperty(counted, "createdBy", { enumerable: true, get: () => { createdByReads += 1; return { id: BOT.id, handle: BOT.handle, name: BOT.name }; } });
  app["sessions"].groups = [{ label: "g1", sessions: [SESSION, counted] }];
  app["shellBotsProps"]();
  const reads = createdByReads;
  assert.equal(reads, 1, "the projection reads each started session once");
  app["conversation"].selected = SESSION;
  assert.deepEqual(app["childSessions"].map(({ id }) => id), ["s-counted"]);
  assert.equal(createdByReads, reads, "the bot's chat reuses the queue's started index instead of walking the registry again");
});

test("the roster's expanded sessions follow the bots that stay", async () => {
  const app = setup();
  app["bots"].toggleSessions(BOT.id);
  assert.deepEqual([...app["bots"].expandedSessions], [BOT.id]);
  app["bots"].toggleSessions(BOT.id);
  assert.equal(app["bots"].expandedSessions.size, 0, "a second press folds them away");
  app["bots"].toggleSessions(BOT.id);
  app["bots"].adopt([{ ...BOT, id: "other", name: "Grace", handle: "grace", sessionId: "s-grace" }]);
  assert.deepEqual([...app["bots"].expandedSessions], [], "a bot that left the roster keeps no expanded row");
  // Every list replacement prunes, not just a local adopt: the stream and a read are how another client's archive lands.
  app["bots"].adopt([BOT]);
  app["bots"].toggleSessions(BOT.id);
  let handlers: Parameters<typeof botApi.subscribeBots>[0] | undefined;
  vi.spyOn(botApi, "subscribeBots").mockImplementation((next) => { handlers = next; return () => {}; });
  vi.mocked(app["bots"].sync).mockRestore();
  app["bots"].sync();
  handlers!.onUpdate({ revision: 1, ids: [BOT.id], upserts: [{ ...BOT, archived: true }] }, true);
  assert.deepEqual(app["bots"].list.map(({ id, archived }) => [id, archived]), [[BOT.id, true]]);
  assert.deepEqual([...app["bots"].expandedSessions], [], "a bot another client archived keeps no expanded row");
  app["bots"].adopt([BOT]);
  app["bots"].toggleSessions(BOT.id);
  vi.spyOn(botApi, "loadBots").mockResolvedValue([{ ...BOT, id: "other", name: "Grace" }]);
  await app["bots"].refresh();
  assert.deepEqual(app["bots"].list.map(({ id }) => id), ["other"]);
  assert.deepEqual([...app["bots"].expandedSessions], [], "a read that no longer has the bot drops its expanded row");
});

test("an open bot panel redraws for the roster's clock every 30 seconds, and a closed one on another tab adds none", () => {
  vi.useFakeTimers();
  vi.stubGlobal("window", globalThis);
  vi.stubGlobal("document", { querySelector: () => null, hidden: false });
  const app = setup();
  const stub = (target: unknown, ...names: string[]) => { for (const name of names) (target as Record<string, unknown>)[name] = async () => {}; };
  stub(app, "refreshSessions", "loadLaunchPreferences");
  stub(app["control"], "pollPower");
  stub(app["launcher"], "loadWorkers");
  stub(app["composer"], "switchDraft", "refreshDraftIndicators");
  app["bots"].selectTab("sessions");
  app["bots"].panel = { open: false, width: 400 };
  // The bot's chat, with its panel closed: nothing of the clock's own shows until the panel opens.
  app["view"] = "bot";
  app["activeBotId"] = BOT.id;
  let redraws = 0;
  app.requestUpdate = () => { redraws += 1; };
  try {
    app.firstUpdated();
    // The bot's chat with its panel closed and the Bots tab away: the clock adds no redraw of its own.
    vi.advanceTimersByTime(60_000);
    assert.equal(redraws, 0);
    // The panel opens: the Work rows age on the same 30 s cadence as the roster.
    app["bots"].panel = { open: true, width: 400 };
    vi.advanceTimersByTime(30_000);
    assert.equal(redraws, 1);
    vi.advanceTimersByTime(20_000);
    assert.equal(redraws, 1, "and not before the next half-minute");
    // Closed again, the Bots tab's own roster clock still runs, once every half-minute.
    app["bots"].panel = { open: false, width: 400 };
    app["bots"].tab = "bots";
    redraws = 0;
    vi.advanceTimersByTime(60_000);
    assert.equal(redraws, 2);
  } finally {
    vi.clearAllTimers();
    vi.useRealTimers();
  }
});
