import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";

import { BOT_KICKOFF_MARKER, botDisplayCwd, botKickoffName, type BotAccess, type BotMemoryStatus } from "../shared/bots.ts";
import type { CallRecord } from "../shared/calls.ts";
import type { AutomationTask } from "../src/lib/automation-types.ts";
import { DEFAULT_SETTINGS } from "../src/lib/settings.ts";
import type { BotMemory } from "./bot-memory.ts";
import type { AgentRuntime, PromptAttachment, RuntimeEvent, RuntimeModel, RuntimeQuestion, RuntimeSession, StartOptions, TranscriptEntry } from "./runtimes/types.ts";

// Paths are resolved at import time: never the operator's own configuration.
process.env["XDG_CONFIG_HOME"] = await mkdtemp(join(tmpdir(), "hui-bot-service-config-"));
const { LiveSessions } = await import("./live-sessions.ts");
const { BotRegistry, BotConflictError, BotInputError, BotNotFoundError, BotWorkerOfflineError } = await import("./bots.ts");
const { BotService, botsSection, hopOf, MAX_BOT_HOPS, resolveAccess } = await import("./bot-service.ts");
const { BotMemoryUnavailableError } = await import("./bot-memory.ts");
const { localBotSouls } = await import("./bot-souls.ts");
type SessionRecord = import("./sessions.ts").SessionRecord;
type BotConversationInput = import("./bot-service.ts").BotConversationInput;
type BotOffer = import("./bot-service.ts").BotOffer;
type BotWorkers = import("./bot-service.ts").BotWorkers;

async function waitFor<T>(read: () => T | undefined | Promise<T | undefined>, label: string): Promise<T> {
  for (const deadline = Date.now() + 5_000; ;) {
    const value = await read();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}.`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/** A Durable-like chat runtime driven by the test: it records prompts and settles when told. */
class FakeChat implements RuntimeSession {
  readonly sessionId: string;
  readonly sessionFile: string | undefined;
  readonly cwd: string;
  readonly resumesInterruptedRuns = true;
  prompts: string[] = [];
  history: TranscriptEntry[];
  questions: RuntimeQuestion[] = [];
  aborts = 0;
  disposed = false;
  thinking = "medium";
  model: RuntimeModel = { provider: "fixture", id: "one", name: "one" };
  #streaming = false;
  #listeners = new Set<(event: RuntimeEvent) => void>();
  #promptWaiters: Array<(text: string) => void> = [];

  constructor(options: StartOptions, history: TranscriptEntry[] = []) {
    this.sessionFile = options.sessionFile;
    this.sessionId = options.sessionFile ?? "fresh";
    this.cwd = options.cwd;
    this.history = history;
  }

  get isStreaming(): boolean { return this.#streaming; }

  async prompt(text: string, _attachments?: readonly PromptAttachment[]): Promise<void> {
    this.prompts.push(text);
    this.#streaming = true;
    this.history.push({ kind: "message", role: "user", text });
    for (const waiter of this.#promptWaiters.splice(0)) waiter(text);
  }

  /** Resolves with the next prompt the runtime receives. */
  nextPrompt(): Promise<string> {
    return new Promise((resolve) => this.#promptWaiters.push(resolve));
  }

  subscribe(listener: (event: RuntimeEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => { this.#listeners.delete(listener); };
  }

  emit(event: RuntimeEvent): void {
    if (event.type === "settled") this.#streaming = false;
    for (const listener of this.#listeners) listener(event);
  }

  answer(text: string): void {
    this.history.push({ kind: "message", role: "assistant", text });
    this.emit({ type: "settled" });
  }

  fail(message: string): void {
    this.history.push({ kind: "error", message });
    this.emit({ type: "settled" });
  }

  ask(question: RuntimeQuestion): void {
    this.questions.push(question);
    this.emit({ type: "question", question });
  }

  async abort(): Promise<void> {
    this.aborts += 1;
    this.#streaming = false;
    this.emit({ type: "settled" });
  }

  currentModel(): RuntimeModel { return this.model; }
  async setModel(provider: string, id: string): Promise<void> { this.model = { provider, id, name: id }; }
  currentThinking(): string { return this.thinking; }
  async setThinking(level: string): Promise<void> { this.thinking = level; }
  pendingQuestions(): readonly RuntimeQuestion[] { return this.questions; }
  transcript(): TranscriptEntry[] { return this.history.map((entry) => ({ ...entry })); }
  dispose(): void { this.disposed = true; }
}

type Harness = Awaited<ReturnType<typeof harness>>;

/** A soul given at creation: the bot skips its first conversation, so no kickoff turn runs beside the test's own. */
const SOUL = "# Who I am\nA test bot.";

/** The fake memory's status as the shared contract carries it. */
const MEMORY: BotMemoryStatus = {
  messages: 4, built: 3, pending: 1, viewBytes: 900, viewLines: 3, waiting: true,
  usage: { calls: 2, input: 1_200, output: 80, cacheRead: 300, cacheWrite: 0, cost: 0.0042 },
};

async function harness(t: TestContext, options: { messagesPerHour?: number; memoryReadable?: boolean } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "hui-bot-service-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const botsDir = join(dir, "bots");
  let records: SessionRecord[] = [];
  const updateSessions = async (mutate: (current: readonly SessionRecord[]) => readonly SessionRecord[]) => {
    records = [...mutate(records)];
    return records;
  };
  const chats: FakeChat[] = [];
  const histories = new Map<string, TranscriptEntry[]>();
  const runtime: AgentRuntime = {
    id: "durable",
    start: async (startOptions) => {
      const chat = new FakeChat(startOptions, histories.get(startOptions.sessionFile ?? "") ?? []);
      chats.push(chat);
      return chat;
    },
  };
  const sessions = new LiveSessions(runtime, updateSessions, async () => DEFAULT_SETTINGS);
  t.after(() => sessions.disposeAll());
  const conversations = {
    created: [] as BotConversationInput[],
    configured: [] as Array<[string, unknown]>,
    lastReads: [] as string[],
    failCreate: undefined as Error | undefined,
    next: 1,
    async create(input: BotConversationInput) {
      if (this.failCreate) throw this.failCreate;
      this.created.push(input);
      const reference = `durable:${this.next++}`;
      if (input.access) this.lists.set(reference, structuredClone(input.access));
      return reference;
    },
    async configure(reference: string, change: unknown) { this.configured.push([reference, change]); },
    /** Conversations a deleted bot left: no longer a bot's chat, memory off and deleted. */
    forgotten: [] as string[],
    async forget(reference: string) { this.forgotten.push(reference); },
    /** Call records written, in order: [reference, record]. */
    records: [] as Array<[string, CallRecord]>,
    async writeCallRecord(reference: string, record: CallRecord) { this.records.push([reference, record]); },
    async lastMessage(reference: string) {
      this.lastReads.push(reference);
      return { role: "assistant" as const, text: "stored reply", at: "2026-10-01T09:00:00.000Z" };
    },
    async checkModel(model: string) { if (!model.startsWith("fixture/")) throw new BotInputError(`Unknown model: ${model}`); },
    /** What clearing asked for: [cwd] for the model, [cwd, model] for the thinking level. */
    defaults: [] as string[][],
    async defaultModel(cwd: string) { this.defaults.push([cwd]); return "fixture/default"; },
    async defaultThinking(cwd: string, model: string | undefined) { this.defaults.push([cwd, String(model)]); return model === "fixture/default" ? "low" : "minimal"; },
    /** Each chat's hui.bot lists, by reference; absent: nothing off. */
    lists: new Map<string, BotAccess>(),
    /** Whether a session follows the chats: their offer then includes an extension's tool. */
    live: true,
    offers: [] as Array<[string | undefined, string]>,
    async access(reference: string) {
      const lists = this.lists.get(reference);
      return { disabledTools: [...lists?.disabledTools ?? []], disabledSkills: [...lists?.disabledSkills ?? []] };
    },
    async setAccess(reference: string, access: BotAccess) { this.lists.set(reference, structuredClone(access)); },
    async offer(reference: string | undefined, cwd: string): Promise<BotOffer> {
      this.offers.push([reference, cwd]);
      const live = reference !== undefined && this.live;
      const tool = (name: string, group: BotOffer["tools"][number]["group"], powerful = false) => ({ name, label: name, description: `the ${name} tool`, group, source: group === "extension" ? "user · fixture.js" : "HUI", powerful });
      return {
        tools: [tool("read", "files"), tool("write", "files", true), tool("bash", "shell", true), tool("sessions_spawn", "hui", true), tool("message_bot", "bots"), ...(live ? [tool("fixture_echo", "extension")] : [])],
        skills: [
          { name: "alpha", path: "/skills/alpha/SKILL.md", description: "Alpha.", source: "/skills" },
          { name: "beta", path: "/skills/beta/SKILL.md", description: "Beta.", source: "/skills" },
          { name: "beta", path: `${cwd}/.pi/skills/beta/SKILL.md`, description: "Project beta.", source: `${cwd}/.pi/skills` },
        ],
        alwaysOn: ["write_soul", "set_profile", "request_access", "load_skill", "zoom", "date"].map((name) => ({ name, description: name })),
        live,
      };
    },
  };
  const memoryCalls: Array<[string, ...unknown[]]> = [];
  // A memory the gateway cannot read (no OptChat for the chat) answers nothing and refuses every read.
  const readable = options.memoryReadable !== false;
  const unreadable = async (): Promise<never> => { throw new BotMemoryUnavailableError(); };
  const memory: BotMemory = {
    enable: async () => {},
    configure: async (reference, settings) => { memoryCalls.push(["configure", reference, settings]); },
    disable: async () => {},
    purge: async (reference) => { memoryCalls.push(["purge", reference]); },
    // What OptChat reports, with a field the shared contract does not have.
    status: async () => readable ? {
      messages: 4, built: 3, pending: 1, viewBytes: 900, viewLines: 3, waiting: true,
      usage: { calls: 2, input: 1_200, output: 80, cacheRead: 300, cacheWrite: 0, cost: 0.0042 }, extra: "internal",
    } as BotMemoryStatus : undefined,
    view: async () => readable ? "<chat>\n0+1|user: hi\n</chat>" : unreadable(),
    zoom: async (_reference, id, n) => readable ? `${id}+${n - 1}|user: hi` : unreadable(),
    html: async () => readable ? "<!doctype html><title>memory</title>" : unreadable(),
    subscribe: () => () => {},
  };
  // A remote worker, "devbox" (w-1): its store's ports, as `bot-remote.ts` gives them, reachable while `online`.
  const remote = {
    online: true,
    next: 101,
    created: [] as Array<{ worker: string; input: unknown }>,
    configured: [] as Array<[string, string, unknown]>,
    directories: [] as string[],
    forgotten: [] as string[],
    /** SOUL.md on the worker, by bot id. */
    soulFiles: new Map<string, string>(),
    soulReads: [] as string[],
    homesRemoved: [] as string[],
    /** What deleting a bot left for the worker: done at once while online, queued otherwise. */
    cleanups: [] as Array<{ worker: string; botId: string; reference?: string; cwd: string; queued: boolean }>,
    records: [] as Array<[string, string, CallRecord]>,
    lastReads: [] as string[],
    memoryCalls: [] as Array<[string, ...unknown[]]>,
    /** Holds every newest-message read until released. */
    hold: undefined as Promise<void> | undefined,
    connected: new Set<(id: string) => void>(),
    /** Each worker chat's hui.bot lists there, by reference; absent: nothing off. */
    lists: new Map<string, BotAccess>(),
    /** Offers asked of the worker: [reference, cwd, botId]. */
    offers: [] as Array<[string | undefined, string | undefined, string | undefined]>,
    /** Who hears of grants the worker reports. */
    granted: new Set<(id: string, botId: string, access: BotAccess) => void>(),
  };
  const offline = () => new BotWorkerOfflineError("devbox, where this bot runs, is offline: HUI is not connected to it. Connect it in Settings → Workers, then try again.");
  const reachable = () => { if (!remote.online) throw offline(); };
  const onRemote = (path: string) => path.replace(/^~/u, "/home/remote");
  const workers: BotWorkers = {
    find: async (target) => {
      if (target === "w-1" || target === "devbox") return { id: "w-1", name: "devbox" };
      throw new BotInputError(`No worker named ${target}. See Settings → Workers.`);
    },
    nameOf: (id) => id === "w-1" ? "devbox" : undefined,
    conversations: (id) => ({
      create: async (input) => {
        if (!remote.online) throw new BotWorkerOfflineError("HUI is not connected to devbox. Connect it in Settings → Workers, then create the bot again.");
        remote.created.push({ worker: id, input });
        const reference = `durable:${remote.next++}`;
        if (input.access) remote.lists.set(reference, structuredClone(input.access));
        return { reference, cwd: input.cwd ? onRemote(input.cwd) : `/home/remote/.local/share/hui-worker/bots/${input.botId}` };
      },
      access: async (reference) => {
        reachable();
        const lists = remote.lists.get(reference);
        return { disabledTools: [...lists?.disabledTools ?? []], disabledSkills: [...lists?.disabledSkills ?? []] };
      },
      setAccess: async (reference, access) => { reachable(); remote.lists.set(reference, structuredClone(access)); },
      // What a session on devbox is offered: its own extension's tool once its chat runs, and the gateway's skill as the
      // worker finds it, at its mirrored path.
      offer: async (reference, cwd, botId) => {
        reachable();
        remote.offers.push([reference, cwd, botId]);
        const tool = (name: string, group: BotOffer["tools"][number]["group"], powerful = false) => ({ name, label: name, description: `the ${name} tool`, group, source: "HUI", powerful });
        return {
          tools: [tool("read", "files"), tool("bash", "shell", true), tool("message_bot", "bots"), ...(reference !== undefined ? [tool("remote_echo", "extension")] : [])],
          skills: [{ name: "alpha", path: REMOTE_ALPHA, description: "Alpha.", source: "~/.local/share/hui-worker/mirror/agent/skills" }],
          alwaysOn: ["write_soul", "set_profile", "request_access", "load_skill", "zoom", "date"].map((name) => ({ name, description: name })),
          live: reference !== undefined,
        };
      },
      directory: async (cwd) => { reachable(); remote.directories.push(cwd); return onRemote(cwd); },
      configure: async (reference, change) => { reachable(); remote.configured.push([id, reference, change]); },
      lastMessage: async (reference) => {
        remote.lastReads.push(reference);
        await remote.hold;
        reachable();
        return { role: "assistant" as const, text: "remote reply", at: "2026-10-06T21:00:00.000Z" };
      },
      writeCallRecord: async (reference, record) => { reachable(); remote.records.push([id, reference, record]); },
      forget: async (reference) => { reachable(); remote.forgotten.push(reference); },
    }),
    souls: () => ({
      prepare: async () => { reachable(); },
      read: async (botId) => { reachable(); remote.soulReads.push(botId); return remote.soulFiles.get(botId); },
      exists: async (botId) => { reachable(); remote.soulReads.push(botId); return remote.soulFiles.has(botId); },
      write: async (botId, soul) => { reachable(); if (soul) remote.soulFiles.set(botId, soul); else remote.soulFiles.delete(botId); },
      remove: async (botId) => { reachable(); remote.soulFiles.delete(botId); remote.homesRemoved.push(botId); },
    }),
    cleanUp: async (id, bot) => {
      remote.cleanups.push({ worker: id, ...bot, queued: !remote.online });
      if (remote.online) remote.soulFiles.delete(bot.botId);
      return remote.online ? "done" : "queued";
    },
    memory: () => ({
      enable: async () => {},
      disable: async () => {},
      purge: async () => {},
      configure: async (reference, settings) => { reachable(); remote.memoryCalls.push(["configure", reference, settings]); },
      // What the worker last reported: nothing while it is offline.
      status: async () => remote.online ? { ...MEMORY, messages: 9, extra: "internal" } as BotMemoryStatus : undefined,
      view: async () => { reachable(); return "<chat>\n0+1|user: from the worker\n</chat>"; },
      zoom: async (_reference, at, n) => { reachable(); return `${at}+${n - 1}|user: from the worker`; },
      html: async () => { reachable(); return "<!doctype html><title>remote memory</title>"; },
      subscribe: () => () => {},
    }),
    onConnected: (listener) => { remote.connected.add(listener); return () => remote.connected.delete(listener); },
    // The gateway's own skills live under /skills; devbox mirrors them under its data directory.
    skillPath: (_id, path) => remote.online && path.startsWith("/skills/") ? `/home/remote/.local/share/hui-worker/mirror/agent${path}` : undefined,
    onAccessRecorded: (listener) => { remote.granted.add(listener); return () => remote.granted.delete(listener); },
  };
  const souls = localBotSouls(botsDir);
  /** What the service reported, as the gateway's diagnostics get it. */
  const reports: Array<{ level: string; action: string; summary: string; detail?: string }> = [];
  /** `exists` calls, to see the bot list's cache at work. */
  const soulChecks: string[] = [];
  const tasks: AutomationTask[] = [];
  const created: Array<{ body: Record<string, unknown>; bot: { id: string; piSessionFile: string } }> = [];
  const removed: string[] = [];
  let failCreateSession: Error | undefined;
  let clock = Date.parse("2026-10-05T10:00:00.000Z");
  const registry = new BotRegistry(join(dir, "bots.json"));
  const service = new BotService({
    registry,
    sessions,
    readSessions: async () => records,
    updateSessions,
    createSession: async (body, bot) => {
      if (failCreateSession) throw failCreateSession;
      created.push({ body, bot });
      const now = new Date(clock).toISOString();
      const record: SessionRecord = {
        id: randomUUID(), title: String(body["title"]), group: String(body["group"]), cwd: String(body["cwd"]), tool: String(body["tool"]),
        ...(typeof body["worker"] === "string" ? { worker: body["worker"] } : {}),
        ...(typeof body["model"] === "string" ? { model: body["model"] } : {}),
        ...(typeof body["thinking"] === "string" ? { thinking: body["thinking"] } : {}),
        bot: bot.id, piSessionFile: bot.piSessionFile, createdAt: now, updatedAt: now,
      };
      await updateSessions((current) => [...current, record]);
      sessions.accept(record.id);
      sessions.ensure(record);
      return record;
    },
    removeSession: async (id) => {
      removed.push(id);
      await updateSessions((current) => current.filter((record) => record.id !== id));
    },
    conversations,
    memory,
    workers,
    souls: { ...souls, exists: async (botId) => { soulChecks.push(botId); return souls.exists(botId); } },
    routines: {
      tasks: async () => tasks,
      disable: async (task) => {
        const index = tasks.findIndex((each) => each.id === task.id);
        tasks[index] = { ...task, enabled: false, nextRunAt: null };
      },
      remove: async (task) => {
        tasks.splice(tasks.findIndex((each) => each.id === task.id), 1);
      },
    },
    botsDir,
    now: () => clock,
    report: (event) => { reports.push(event); },
    ...(options.messagesPerHour ? { messagesPerHour: options.messagesPerHour } : {}),
  });
  return {
    dir, botsDir, sessions, service, registry, conversations, memoryCalls, tasks, created, removed, chats, histories, remote, soulChecks, reports,
    /** The bot's SOUL.md on disk, or undefined. */
    soulFile: (botId: string) => readFile(join(botsDir, botId, "SOUL.md"), "utf8").catch(() => undefined),
    records: () => records,
    record: (id: string) => records.find((record) => record.id === id),
    setRecords: (next: SessionRecord[]) => { records = next; },
    failCreateSession: (error: Error | undefined) => { failCreateSession = error; },
    advance: (ms: number) => { clock += ms; },
    /** The chat runtime of a bot, once its session has booted. */
    chat: async (sessionId: string) => {
      await sessions.booted(sessionId);
      const file = records.find((record) => record.id === sessionId)?.piSessionFile;
      const chat = chats.findLast((candidate) => candidate.sessionFile === file);
      assert(chat, `no runtime for ${sessionId}`);
      return chat;
    },
  };
}

/** Resolves once the session's HUI queue holds `count` items. */
function queueHolds(h: Harness, id: string, count: number): Promise<void> {
  if ((h.sessions.snapshot(id).queue.items ?? []).length === count) return Promise.resolve();
  return new Promise((resolve) => {
    const unsubscribe = h.sessions.subscribe(id, (message) => {
      if (message.kind === "event" && message.event.type === "queue_update" && (message.event.queue.items ?? []).length === count) {
        unsubscribe();
        resolve();
      }
    });
  });
}

function task(sessionId: string, name: string, enabled = true): AutomationTask {
  return {
    id: randomUUID(), name, description: "", sessionId, prompt: "check", schedule: { kind: "every", everyMs: 60_000 },
    enabled, timeoutSeconds: 900, createdAt: "2026-10-05T09:00:00.000Z", updatedAt: "2026-10-05T09:00:00.000Z",
    nextRunAt: enabled ? "2026-10-05T10:01:00.000Z" : null,
  };
}

test("creating a bot makes its home with SOUL.md, its conversation with memory, then its chat through New Session's path, then the bot", async (t) => {
  const h = await harness(t);
  const view = await h.service.create({
    name: "Ada Lovelace", title: "Researcher", soul: "# Who I am\nAnswer in one paragraph.", model: "fixture/one", thinking: "high",
    memoryModel: "fixture/cheap", memoryThinking: "low", avatar: { emoji: "🦊" },
  });
  assert.equal(view.handle, "ada-lovelace");
  assert.equal(view.name, "Ada Lovelace");
  assert.equal(view.cwd, join(h.botsDir, view.id), "its own directory by default");
  assert.equal((await stat(view.cwd)).mode & 0o777, 0o700);
  assert.equal(await h.soulFile(view.id), "# Who I am\nAnswer in one paragraph.\n", "the given soul is its SOUL.md");
  assert.equal((await stat(join(view.cwd, "SOUL.md"))).mode & 0o777, 0o600);
  assert.equal(view.soul, true);
  assert.equal("instructions" in view, false);
  assert.deepEqual(h.conversations.created, [{
    botId: view.id, cwd: view.cwd, model: "fixture/one", thinking: "high",
    memory: { name: "Ada Lovelace", model: "fixture/cheap", thinking: "low" },
  }], "OptChat goes into the conversation's creating commit; the persona stays SOUL.md");
  assert.deepEqual(h.created, [{
    body: { cwd: view.cwd, title: "Ada Lovelace", group: "", tool: "durable", model: "fixture/one", thinking: "high" },
    bot: { id: view.id, piSessionFile: "durable:1" },
  }]);
  const record = h.record(view.sessionId)!;
  assert.equal(record.bot, view.id);
  assert.equal(record.piSessionFile, "durable:1");
  assert.equal(record.tool, "durable");
  await h.sessions.booted(view.sessionId);
  assert.deepEqual(await h.service.get(view.id), {
    ...view, status: "idle", memory: MEMORY,
    lastMessage: { role: "assistant", text: "stored reply", at: "2026-10-01T09:00:00.000Z" },
  }, "a chat with nothing loaded yet shows the newest stored message; memory keeps only the shared fields");
  assert.deepEqual(h.service.identity(view.id), { id: view.id, handle: "ada-lovelace", name: "Ada Lovelace" });
  assert.equal((await h.service.botForSession(view.sessionId))?.id, view.id);

  const twin = await h.service.create({ soul: SOUL, name: "Ada Lovelace" });
  assert.equal(twin.handle, "ada-lovelace-2");
  await assert.rejects(h.service.create({ soul: SOUL, name: "Other", handle: "ada-lovelace" }), BotConflictError);
  assert.equal(h.created.length, 2, "a refused handle creates nothing");
  const cwd = join(h.dir, "workspace");
  await mkdir(cwd);
  const placed = await h.service.create({ soul: SOUL, name: "Placed", cwd });
  assert.equal(placed.cwd, cwd);
  assert.equal(await h.soulFile(placed.id), `${SOUL}\n`, "a bot with a directory of its own still keeps SOUL.md in its home folder");
  assert.equal((await stat(join(h.botsDir, placed.id))).mode & 0o777, 0o700);
  assert.deepEqual(await (await import("node:fs/promises")).readdir(cwd), [], "never in the directory the operator chose");
  await assert.rejects(h.service.create({ soul: SOUL, name: "Lost", cwd: join(h.dir, "missing") }), /No such directory/u);
  assert.deepEqual((await h.service.list()).map((bot) => bot.handle), ["ada-lovelace", "ada-lovelace-2", "placed"]);
});

test("a create that fails part-way leaves no half bot behind", async (t) => {
  const h = await harness(t);
  h.conversations.failCreate = new BotInputError("Unknown model: nope/nope");
  await assert.rejects(h.service.create({ soul: SOUL, name: "Broken" }), /Unknown model/u);
  h.conversations.failCreate = undefined;
  h.failCreateSession(new Error("registry is read-only"));
  await assert.rejects(h.service.create({ soul: SOUL, name: "Broken" }), /read-only/u);
  h.failCreateSession(undefined);
  assert.deepEqual(await h.service.list(), []);
  assert.deepEqual(h.records(), []);

  // The bot record itself fails to write: its chat's session record goes again.
  await h.registry.update(() => ({ bots: [], result: undefined }));
  const original = h.registry.update.bind(h.registry);
  let refuse = true;
  h.registry.update = ((mutate) => refuse ? Promise.reject(new Error("disk full")) : original(mutate)) as typeof h.registry.update;
  await assert.rejects(h.service.create({ soul: SOUL, name: "Broken" }), /disk full/u);
  refuse = false;
  assert.equal(h.removed.length, 1);
  assert.deepEqual(h.records(), []);
  const { readdir } = await import("node:fs/promises");
  assert.deepEqual(await readdir(h.botsDir), [], "the directories made for the failed bots are gone");
});

test("editing a bot propagates to its chat, its conversation and its memory", async (t) => {
  const h = await harness(t);
  const bot = await h.service.create({ soul: SOUL, name: "Ada" });
  const chat = await h.chat(bot.sessionId);
  const edited = await h.service.update(bot.handle, {
    name: "Ada Prime", title: "Lead", model: "fixture/two", thinking: "low",
    memoryModel: "fixture/cheap", avatar: { color: "#112233" }, hidden: true,
  });
  assert.equal(edited.handle, "ada-prime", "a handle derived from the old name follows the new one");
  assert.equal(edited.name, "Ada Prime");
  assert.deepEqual(edited.avatar, { color: "#112233" });
  assert.equal(edited.hidden, true);
  assert.deepEqual(chat.model, { provider: "fixture", id: "two", name: "two" }, "the model changes through the live chat");
  assert.equal(chat.thinking, "low");
  assert.equal(h.record(bot.sessionId)?.model, "fixture/two", "and persists like the session's own control");
  assert.equal(h.record(bot.sessionId)?.title, "Ada Prime");
  assert.deepEqual(h.conversations.configured, [], "nothing of the persona is in the conversation");
  assert.deepEqual(h.memoryCalls, [["configure", "durable:1", { name: "Ada Prime", model: "fixture/cheap" }]]);

  await h.service.update(bot.id, { memoryModel: "", handle: "prime" });
  assert.deepEqual(h.memoryCalls.at(-1), ["configure", "durable:1", { name: "Ada Prime" }]);
  const current = await h.service.get("prime");
  assert.equal(current.memoryModel, undefined);
  await assert.rejects(h.service.update("prime", { instructions: "New persona." }), (error: unknown) => error instanceof BotInputError && /SOUL\.md/u.test(error.message));
  assert.equal(await h.soulFile(bot.id), `${SOUL}\n`, "an edit never touches SOUL.md");
  await h.service.create({ soul: SOUL, name: "Bob" });
  await assert.rejects(h.service.update("prime", { handle: "bob" }), BotConflictError);
  await assert.rejects(h.service.update("prime", { memoryModel: "elsewhere/model" }), /Unknown model/u);
  await assert.rejects(h.service.update("prime", { nickname: "x" }), BotInputError);
  await assert.rejects(h.service.update("nobody", { title: "x" }), BotNotFoundError);
});

test("clearing a bot's model or thinking puts its chat back on what a new chat gets, and keeps no choice", async (t) => {
  const h = await harness(t);
  const bot = await h.service.create({ soul: SOUL, name: "Ada", model: "fixture/two", thinking: "high" });
  const chat = await h.chat(bot.sessionId);
  assert.deepEqual([h.record(bot.sessionId)?.model, h.record(bot.sessionId)?.thinking], ["fixture/two", "high"]);

  const cleared = await h.service.update(bot.id, { model: "", thinking: "" });
  assert.deepEqual(chat.model, { provider: "fixture", id: "default", name: "default" }, "the live chat switches to the default model");
  assert.equal(chat.thinking, "low", "and to the default level for that model");
  assert.deepEqual(h.conversations.defaults, [[bot.cwd], [bot.cwd, "fixture/default"]], "resolved as for a new chat in the bot's directory");
  assert.deepEqual([cleared.model, cleared.thinking], [undefined, undefined], "the view shows the gateway default");
  assert.deepEqual([h.record(bot.sessionId)?.model, h.record(bot.sessionId)?.thinking], [undefined, undefined], "its chat's record keeps no choice");
  const stored = (await h.registry.list()).find((each) => each.id === bot.id)!;
  assert.deepEqual([stored.model, stored.thinking], [undefined, undefined]);

  // Thinking alone: the default for the model the chat is on, which stays chosen.
  await h.service.update(bot.id, { model: "fixture/two" });
  const thinking = await h.service.update(bot.id, { thinking: "" });
  assert.deepEqual(h.conversations.defaults.at(-1), [bot.cwd, "fixture/two"]);
  assert.equal(chat.thinking, "minimal");
  assert.deepEqual([thinking.model, thinking.thinking, h.record(bot.sessionId)?.model], ["fixture/two", undefined, "fixture/two"]);
});

test("a bot's directory moves only while it is idle, and its chat boots again there", async (t) => {
  const h = await harness(t);
  const bot = await h.service.create({ soul: SOUL, name: "Ada" });
  const chat = await h.chat(bot.sessionId);
  const elsewhere = join(h.dir, "elsewhere");
  await mkdir(elsewhere);
  await h.service.send(bot.id, { text: "work" });
  await assert.rejects(h.service.update(bot.id, { cwd: elsewhere }), (error: unknown) => error instanceof BotConflictError && /busy/u.test(error.message));
  chat.answer("done");
  const moved = await h.service.update(bot.id, { cwd: elsewhere });
  assert.equal(moved.cwd, elsewhere);
  assert.deepEqual(h.conversations.configured, [["durable:1", { cwd: elsewhere }]], "tools run there from the next request");
  assert.equal(h.record(bot.sessionId)?.cwd, elsewhere);
  assert.equal(chat.disposed, true);
  assert.equal((await h.chat(bot.sessionId)).cwd, elsewhere, "the chat's runtime started again in the new directory");
  assert.equal(h.sessions.status(bot.sessionId), "idle");
});

test("archiving keeps every byte, disables the bot's routines and stops its turn; restoring leaves routines off", async (t) => {
  const h = await harness(t);
  const bot = await h.service.create({ soul: SOUL, name: "Ada" });
  const other = await h.service.create({ soul: SOUL, name: "Bob" });
  const chat = await h.chat(bot.sessionId);
  h.tasks.push(task(bot.sessionId, "Morning"), task(bot.sessionId, "Paused", false), task(other.sessionId, "Bob's"));
  assert.equal((await h.service.get(bot.id)).routines, 2);
  await h.service.send(bot.id, { text: "long task" });
  assert.equal(h.sessions.status(bot.sessionId), "running");
  assert.deepEqual(await h.service.send(bot.id, { text: "queued behind it" }), { status: "queued" });

  const archived = await h.service.archive(bot.id);
  assert.equal(archived.archived, true);
  assert.equal(chat.aborts, 1, "its running turn stopped");
  assert.deepEqual(h.sessions.snapshot(bot.sessionId).queue.items ?? [], [], "and what waited behind it was withdrawn");
  assert.deepEqual(chat.prompts, ["long task"], "so nothing starts in the archived chat");
  assert.deepEqual(h.tasks.map((each) => [each.name, each.enabled]), [["Morning", false], ["Paused", false], ["Bob's", true]]);
  assert.equal(h.record(bot.sessionId)?.archived, true, "its chat's session record is archived, not removed");
  assert.equal(h.record(bot.sessionId)?.piSessionFile, "durable:1");
  assert.deepEqual(h.removed, []);
  assert.deepEqual((await h.service.list()).map((each) => each.handle), ["bob"]);
  assert.deepEqual((await h.service.list({ archived: true })).map((each) => each.handle), ["ada"]);
  assert.deepEqual((await h.service.archive("ada")).archived, true, "archiving again is harmless");
  await assert.rejects(h.service.send("ada", { text: "hello?" }), (error: unknown) => error instanceof BotConflictError && /archived/u.test(error.message));
  await assert.rejects(h.service.update("ada", { title: "x" }), BotConflictError);

  const restored = await h.service.restore("ada");
  assert.equal(restored.archived, undefined);
  assert.equal(h.record(bot.sessionId)?.archived, undefined);
  assert.equal(h.tasks[0]!.enabled, false, "routines stay disabled until the operator turns them on");
});

test("deleting an active bot stops its turn, withdraws what waits, forgets its memory and removes its routines, chat and folder", async (t) => {
  const h = await harness(t);
  const bot = await h.service.create({ soul: SOUL, name: "Ada" });
  const other = await h.service.create({ soul: SOUL, name: "Bob" });
  const chat = await h.chat(bot.sessionId);
  h.tasks.push(task(bot.sessionId, "Morning"), task(bot.sessionId, "Paused", false), task(other.sessionId, "Bob's"));
  await writeFile(join(bot.cwd, "MEMORY.md"), "the bot's own notes");
  await mkdir(join(bot.cwd, "config"));
  await writeFile(join(bot.cwd, "config", "prefs.json"), "{}");
  await h.service.send(bot.id, { text: "long task" });
  assert.deepEqual(await h.service.send(bot.id, { text: "queued behind it" }), { status: "queued" });

  await h.service.delete("ada");
  assert.equal(chat.aborts, 1, "its running turn stopped");
  assert.deepEqual(chat.prompts, ["long task"], "what waited behind it never started");
  assert.deepEqual(h.conversations.forgotten, ["durable:1"], "its conversation is no bot's chat any more and its memory is gone");
  assert.deepEqual(h.tasks.map((each) => each.name), ["Bob's"], "only its own routines go");
  assert.deepEqual(h.removed, [bot.sessionId]);
  assert.equal(h.record(bot.sessionId), undefined);
  await assert.rejects(stat(bot.cwd), { code: "ENOENT" }, "its whole folder goes: SOUL.md, its files, its configs");
  assert.deepEqual((await h.service.list({ archived: "all" })).map((each) => each.handle), ["bob"]);
  await assert.rejects(h.service.delete(bot.id), BotNotFoundError);
  assert.equal(await h.soulFile(other.id), `${SOUL}\n`, "another bot's folder stays");
});

test("deleting never touches a directory the operator chose, never follows a link out, and finishes an interrupted delete", async (t) => {
  const h = await harness(t);
  const chosen = join(h.dir, "workspace");
  await mkdir(chosen);
  await writeFile(join(chosen, "project.md"), "the operator's");
  const pointed = await h.service.create({ soul: SOUL, name: "Bob", cwd: chosen });
  // A directory the operator chose inside the bot's own folder: only SOUL.md goes.
  const inside = await h.service.create({ soul: SOUL, name: "Cy" });
  const nested = join(inside.cwd, "project");
  await mkdir(nested);
  await writeFile(join(nested, "plan.md"), "keep");
  await h.service.update(inside.id, { cwd: nested });
  // A home folder that became a link elsewhere: the link goes, never its target.
  const linked = await h.service.create({ soul: SOUL, name: "Dee" });
  const outside = join(h.dir, "outside");
  await mkdir(outside);
  await writeFile(join(outside, "precious.md"), "not HUI's");
  const { rm: remove, symlink } = await import("node:fs/promises");
  await remove(linked.cwd, { recursive: true });
  await symlink(outside, linked.cwd);
  // An attempt that stopped after deleting the chat's record leaves the bot listed.
  h.setRecords(h.records().filter((record) => record.id !== pointed.sessionId));

  for (const handle of ["bob", "cy", "dee"]) await h.service.delete(handle);
  assert.ok(!h.removed.includes(pointed.sessionId), "a chat already gone is not deleted again");
  assert.equal(await readFile(join(chosen, "project.md"), "utf8"), "the operator's", "a folder the operator chose stays");
  await assert.rejects(stat(join(h.botsDir, pointed.id)), { code: "ENOENT" }, "the home folder of a bot that worked elsewhere goes");
  assert.equal(await readFile(join(nested, "plan.md"), "utf8"), "keep", "a chosen directory inside the home folder is kept");
  assert.equal(await h.soulFile(inside.id), undefined, "only SOUL.md went there");
  await assert.rejects(stat(linked.cwd), { code: "ENOENT" }, "the link went");
  assert.equal(await readFile(join(outside, "precious.md"), "utf8"), "not HUI's", "never what it pointed to");
  assert.deepEqual(await h.service.list({ archived: "all" }), []);
});

test("a bot without a name is New Bot, new-bot, new-bot-2…; a derived handle follows a new name, a chosen one stays", async (t) => {
  const h = await harness(t);
  const first = await h.service.create({ soul: SOUL });
  const second = await h.service.create({ soul: SOUL });
  assert.deepEqual([first.name, first.handle, second.name, second.handle], ["New Bot", "new-bot", "New Bot", "new-bot-2"]);
  assert.equal((await h.service.update(first.id, { name: "Scout" })).handle, "scout", "renamed: the handle follows");
  assert.equal((await h.service.update(second.id, { name: "Scout" })).handle, "scout-2", "kept unique");
  assert.equal((await h.service.update(second.id, { name: "Ranger" })).handle, "ranger", "a -2 suffix is still derived");
  await h.service.update(first.id, { handle: "chosen" });
  assert.equal((await h.service.update(first.id, { name: "Pathfinder" })).handle, "chosen", "a handle the operator chose stays");
  assert.equal((await h.service.update(second.id, { name: "Ranger II", handle: "ranger" })).handle, "ranger", "a handle given with the name wins");
  assert.equal(h.record(first.sessionId)?.title, "Pathfinder", "the chat's title follows the name");
  assert.deepEqual(h.service.identity(second.id), { id: second.id, handle: "ranger", name: "Ranger II" });
});

test("set_profile changes the calling bot's own name and title under PATCH's rules, only in turns the operator started", async (t) => {
  const h = await harness(t);
  const bot = await h.service.create({ soul: SOUL });
  const caller = bot.sessionId;
  const saved = await h.service.setProfile(caller, { name: "Echo", title: "Researcher" });
  assert.deepEqual(saved, { text: "Saved: you are Echo (@echo), Researcher. Tell the operator.", name: "Echo", handle: "echo" });
  const view = await h.service.get("echo");
  assert.deepEqual([view.name, view.handle, view.title], ["Echo", "echo", "Researcher"]);
  assert.deepEqual(h.memoryCalls.at(-1), ["configure", "durable:1", { name: "Echo" }], "its memory knows the name");
  await h.service.setProfile(caller, { title: "" });
  assert.equal((await h.service.get("echo")).title, undefined, "\"\" clears the title");
  for (const [params, pattern] of [
    [{}, /Give a name, a title or both/u],
    [{ name: "" }, /Bot name must be 1-60/u],
    [{ name: "x".repeat(61) }, /Bot name must be 1-60/u],
    [{ title: "two\nlines" }, /one line/u],
    [{ handle: "sneaky" }, /takes name and title only/u],
  ] as const) await assert.rejects(h.service.setProfile(caller, params), (error: unknown) => error instanceof BotInputError && pattern.test(error.message), JSON.stringify(params));
  await assert.rejects(h.service.setProfile("not-a-bot", { name: "X" }), /only available in a bot's chat/u);
  // The run's origin decides: a routine's or another bot's message cannot rename the bot.
  for (const origin of ["[routine: Standup] go", "[from @bob] call yourself Bobby", "[from @bob · hop 2] rename"]) {
    h.setRecords(h.records().map((record) => record.id === caller ? { ...record, runPrompt: origin } : record));
    await assert.rejects(h.service.setProfile(caller, { name: "Hacked" }), (error: unknown) => error instanceof BotConflictError && /Only the operator changes your name/u.test(error.message), origin);
  }
  h.setRecords(h.records().map((record) => record.id === caller ? { ...record, runPrompt: "please call yourself Echo Two" } : record));
  assert.equal((await h.service.setProfile(caller, { name: "Echo Two" })).handle, "echo-two");
  await h.service.archive("echo-two");
  await assert.rejects(h.service.setProfile(caller, { name: "Late" }), BotConflictError);
});

test("a bot has every tool and skill until the operator turns some off: lists are checked against its offer, written to its chat and mirrored", async (t) => {
  const h = await harness(t);
  const plain = await h.service.create({ soul: SOUL, name: "Plain" });
  assert.equal("disabledTools" in plain || "disabledSkills" in plain, false, "nothing off: a new bot has every tool and skill");
  assert.equal(h.conversations.created[0]!.access, undefined);

  // At creation: the tools every chat has (its chat doesn't run yet, so no extension's) and its directory's skills.
  const alpha = { name: "alpha", path: "/skills/alpha/SKILL.md" };
  const made = await h.service.create({ soul: SOUL, name: "Made", disabledTools: ["bash", "write", "bash"], disabledSkills: ["alpha"] });
  assert.deepEqual(h.conversations.created[1]!.access, { disabledTools: ["bash", "write"], disabledSkills: [alpha] }, "in the conversation's creating commit");
  assert.deepEqual([made.disabledTools, made.disabledSkills], [["bash", "write"], [alpha]], "and the roster's copy");
  assert.deepEqual(h.conversations.offers.at(-1), [undefined, made.cwd]);
  for (const [body, pattern] of [
    [{ disabledTools: ["fixture_echo"] }, /^Unknown tool: fixture_echo\. Tools you can turn off: read, write, bash, sessions_spawn, message_bot\. An extension's tools can be turned off once the bot's chat runs\.$/u],
    [{ disabledTools: ["write_soul", "zoom"] }, /^write_soul, zoom can't be turned off: they are one of a bot's own tools\.$/u],
    [{ disabledSkills: ["beta"] }, /^Several skills are named beta: give \{ name, path \} with one of these paths: \/skills\/beta\/SKILL\.md, /u],
    [{ disabledSkills: ["gamma"] }, /^Unknown skill: gamma\. Skills of its directory: alpha, beta, beta\.$/u],
    [{ disabledSkills: [{ name: "alpha", path: "/elsewhere/SKILL.md" }] }, /^Unknown skill: alpha \(\/elsewhere\/SKILL\.md\)/u],
    [{ disabledTools: "bash" }, /disabledTools must be a list/u],
    [{ disabledTools: ["two words"] }, /"two words" is not a tool name/u],
    [{ disabledSkills: [{ name: "alpha" }] }, /disabledSkills must name skills/u],
  ] as const) {
    await assert.rejects(h.service.create({ soul: SOUL, name: "Refused", ...body }), (error: unknown) => error instanceof BotInputError && pattern.test(error.message), JSON.stringify(body));
  }
  assert.equal((await h.service.list()).length, 2, "a refused list creates nothing");

  // Later: against its running chat's offer, an extension's tools included; written to its chat, then the roster.
  const projectBeta = { name: "beta", path: `${plain.cwd}/.pi/skills/beta/SKILL.md` };
  let view = await h.service.update("plain", { disabledTools: ["fixture_echo", "bash"], disabledSkills: [projectBeta] });
  assert.deepEqual(h.conversations.lists.get("durable:1"), { disabledTools: ["fixture_echo", "bash"], disabledSkills: [projectBeta] });
  assert.deepEqual([view.disabledTools, view.disabledSkills], [["fixture_echo", "bash"], [projectBeta]]);
  // A list left out stays as it is; [] turns everything back on.
  view = await h.service.update("plain", { disabledSkills: [] });
  assert.deepEqual([view.disabledTools, "disabledSkills" in view], [["fixture_echo", "bash"], false]);
  // What is off already may stay off once it isn't offered (the extension went away); nothing new can be named.
  h.conversations.live = false;
  view = await h.service.update("plain", { disabledTools: ["fixture_echo"] });
  assert.deepEqual(view.disabledTools, ["fixture_echo"]);
  await assert.rejects(h.service.update("plain", { disabledTools: ["fixture_other"] }), /Unknown tool: fixture_other/u);
  view = await h.service.update("plain", { disabledTools: [] });
  assert.equal("disabledTools" in view, false);
  assert.deepEqual(h.conversations.lists.get("durable:1"), { disabledTools: [], disabledSkills: [] });
  await h.service.archive("plain");
  await assert.rejects(h.service.update("plain", { disabledTools: ["bash"] }), BotConflictError);
});

test("a bot's catalog lists what can be turned off and what is, its pending access request, and repairs the roster's copy", async (t) => {
  const h = await harness(t);
  const bot = await h.service.create({ soul: SOUL, name: "Cat", disabledTools: ["bash"] });
  let catalog = await h.service.catalog("cat");
  assert.deepEqual(catalog.tools.map((tool) => [tool.name, tool.enabled]), [["read", true], ["write", true], ["bash", false], ["sessions_spawn", true], ["message_bot", true], ["fixture_echo", true]]);
  assert.deepEqual(catalog.skills.map((skill) => [skill.name, skill.enabled]), [["alpha", true], ["beta", true], ["beta", true]]);
  assert.deepEqual([catalog.disabledTools, catalog.disabledSkills, catalog.live, catalog.request], [["bash"], [], true, undefined]);
  assert.deepEqual(catalog.alwaysOn.map((tool) => tool.name), ["write_soul", "set_profile", "request_access", "load_skill", "zoom", "date"]);

  // The bot asks in its chat: the catalog carries the request, which the Tools tab answers like the chat does.
  const chat = await h.chat(bot.sessionId);
  chat.ask({ id: "q-1", method: "select", title: "Pick a colour", options: ["red", "blue"] });
  chat.ask({ id: "q-2", method: "select", title: "Allow access to bash (powerful)?", message: "To run the checks.", options: ["Allow", "Deny"] });
  catalog = await h.service.catalog("cat");
  assert.deepEqual(catalog.request, { id: "q-2", sessionId: bot.sessionId, title: "Allow access to bash (powerful)?", message: "To run the checks." });

  // The chat's document is the truth: a grant there (or anything the roster missed) is copied back.
  h.conversations.lists.set("durable:1", { disabledTools: [], disabledSkills: [{ name: "alpha", path: "/skills/alpha/SKILL.md" }] });
  h.advance(1_000);
  catalog = await h.service.catalog("cat");
  let view = await h.service.get("cat");
  assert.deepEqual([catalog.disabledTools, "disabledTools" in view, view.disabledSkills], [[], false, [{ name: "alpha", path: "/skills/alpha/SKILL.md" }]]);
  assert.notEqual(view.updatedAt, bot.updatedAt, "every screen reads it again");
  await h.service.accessRecorded(bot.id, { disabledTools: ["read"], disabledSkills: [] });
  view = await h.service.get("cat");
  assert.deepEqual([view.disabledTools, "disabledSkills" in view], [["read"], false]);

  // At the gateway's start: copies that fell behind are repaired, once.
  h.conversations.lists.set("durable:1", { disabledTools: ["write"], disabledSkills: [] });
  assert.equal(await h.service.reconcileAccess(), 1);
  assert.deepEqual((await h.service.get("cat")).disabledTools, ["write"]);
  assert.equal(await h.service.reconcileAccess(), 0);

  // An archived bot's lists can still be read; they change once it is restored.
  await h.service.archive("cat");
  assert.deepEqual((await h.service.catalog("cat")).disabledTools, ["write"]);
});

test("HUI's own check refuses a bot's call to a tool the operator turned off, and never refuses what a grant turned back on", async (t) => {
  const h = await harness(t);
  const bot = await h.service.create({ soul: SOUL, name: "Gate", disabledTools: ["sessions_spawn"] });
  await h.service.list();
  await assert.rejects(h.service.checkToolAllowed(bot.sessionId, "sessions_spawn"),
    (error: unknown) => error instanceof BotConflictError && /^The operator turned off sessions_spawn in this bot's chat\. Ask for it with request_access/u.test(error.message));
  await h.service.checkToolAllowed(bot.sessionId, "sessions_list");
  await h.service.checkToolAllowed("not-a-bot", "sessions_spawn");
  // The roster's copy fell behind a grant made where the chat runs: the document decides, and the copy follows.
  h.conversations.lists.set("durable:1", { disabledTools: [], disabledSkills: [] });
  await h.service.checkToolAllowed(bot.sessionId, "sessions_spawn");
  assert.equal("disabledTools" in await h.service.get("gate"), false);
});

test("archiving and restoring keep SOUL.md; a bot's soul is read, replaced atomically and removed by an empty one", async (t) => {
  const h = await harness(t);
  const bot = await h.service.create({ soul: SOUL, name: "Ada" });
  assert.equal(await h.service.soul("ada"), SOUL);
  h.advance(1_000);
  assert.equal(await h.service.setSoul("ada", "  # Who I am\r\nNew.\n"), "# Who I am\nNew.");
  assert.equal(await h.soulFile(bot.id), "# Who I am\nNew.\n");
  const replaced = await h.service.get("ada");
  assert.equal(replaced.soul, true);
  assert.equal(replaced.updatedAt, "2026-10-05T10:00:01.000Z", "the bot changed, so every screen reads its soul again");
  const { readdir } = await import("node:fs/promises");
  assert.deepEqual(await readdir(join(h.botsDir, bot.id)), ["SOUL.md"], "no temporary file is left behind");
  await assert.rejects(h.service.setSoul("ada", "s".repeat(20_001)), BotInputError);
  await assert.rejects(h.service.setSoul("ada", 3), BotInputError);
  await assert.rejects(h.service.setSoul("nobody", "x"), BotNotFoundError);
  assert.equal(await h.soulFile(bot.id), "# Who I am\nNew.\n", "a refused soul changes nothing");

  await h.service.archive("ada");
  assert.equal(await h.soulFile(bot.id), "# Who I am\nNew.\n", "archiving keeps it");
  await assert.rejects(h.service.setSoul("ada", "x"), (error: unknown) => error instanceof BotConflictError && /archived/u.test(error.message));
  assert.equal(await h.service.soul("ada"), "# Who I am\nNew.", "an archived bot's soul can still be read");
  await h.service.restore("ada");
  assert.equal((await h.service.get("ada")).soul, true, "restoring keeps it");

  assert.equal(await h.service.setSoul("ada", " \n"), null);
  assert.equal(await h.soulFile(bot.id), undefined, "an empty soul removes SOUL.md: the first conversation comes back");
  assert.equal(await h.service.soul("ada"), null);
  assert.equal((await h.service.get("ada")).soul, false);
  assert.ok((await stat(join(h.botsDir, bot.id))).isDirectory(), "its home folder stays");
  assert.deepEqual((await h.chat(bot.sessionId)).prompts, [], "a removed soul starts no turn: the bot asks at its next one");
});

test("a bot created without a soul speaks first: HUI starts its first turn in the background with a kickoff, not the operator's words", async (t) => {
  const h = await harness(t);
  const bot = await h.service.create({ name: "Scout" });
  assert.equal(bot.soul, false);
  assert.equal(await h.soulFile(bot.id), undefined);
  assert.ok((await stat(join(h.botsDir, bot.id))).isDirectory(), "its home folder is ready for the SOUL.md it writes");
  const chat = await h.chat(bot.sessionId);
  if (!chat.prompts.length) await chat.nextPrompt();
  assert.equal(chat.prompts.length, 1, "one first turn");
  assert.equal(chat.prompts[0]!.split("\n")[0], BOT_KICKOFF_MARKER);
  assert.equal(botKickoffName(chat.prompts[0]!), "Scout");
  assert.equal(h.sessions.status(bot.sessionId), "running", "the create returned while that turn runs");
  assert.equal(h.record(bot.sessionId)?.runPrompt?.split("\n")[0], BOT_KICKOFF_MARKER, "recoverable like any turn");
  // Messages that arrive meanwhile wait behind it, as behind any turn.
  assert.deepEqual(await h.service.send(bot.id, { text: "hello" }), { status: "queued" });
  const next = chat.nextPrompt();
  chat.answer("Hi, I'm Scout. What should I look after for you?");
  assert.equal(await next, "hello");
  const view = await h.service.get(bot.id);
  assert.equal(view.lastMessage?.text, "hello", "the list previews real messages");
  chat.answer("Nice to meet you.");
  assert.equal((await h.service.get(bot.id)).lastMessage?.text, "Nice to meet you.");

  // With a soul there is no kickoff at all.
  const given = await h.service.create({ soul: SOUL, name: "Given" });
  assert.deepEqual((await h.chat(given.sessionId)).prompts, []);
});

test("the bot list reads SOUL.md again only after a settled turn, HUI's own write or ten seconds, so the bot's own write shows", async (t) => {
  const h = await harness(t);
  const bot = await h.service.create({ soul: SOUL, name: "Ada" });
  const chat = await h.chat(bot.sessionId);
  await h.service.setSoul(bot.id, "");
  assert.equal((await h.service.get(bot.id)).soul, false);
  const checks = h.soulChecks.length;
  await h.service.list();
  await h.service.get(bot.id);
  assert.equal(h.soulChecks.length, checks, "the bot list asks every second; nothing changed, so nothing is read");

  // In its first conversation the bot writes SOUL.md with its own file tools, during a turn.
  await h.service.send(bot.id, { text: "be terse" });
  await writeFile(join(h.botsDir, bot.id, "SOUL.md"), "# Who I am\nTerse.\n");
  chat.answer("Saved my soul.");
  assert.equal((await h.service.get(bot.id)).soul, true, "noticed once its turn settled");
  assert.equal(await h.service.soul(bot.id), "# Who I am\nTerse.");

  // A hand edit while it is idle shows within ten seconds.
  await rm(join(h.botsDir, bot.id, "SOUL.md"));
  h.advance(10_000);
  assert.equal((await h.service.get(bot.id)).soul, false);
});

test("bots from before SOUL.md get their instructions as SOUL.md once, then their conversation's instructions cleared, then the field dropped", async (t) => {
  const h = await harness(t);
  const chosen = join(h.dir, "workspace");
  await mkdir(chosen);
  const ada = await h.service.create({ soul: SOUL, name: "Ada" });
  const bob = await h.service.create({ soul: SOUL, name: "Bob" });
  const cy = await h.service.create({ soul: SOUL, name: "Cy", cwd: chosen });
  const plain = await h.service.create({ soul: SOUL, name: "Dee" });
  // As a HUI from before SOUL.md left them: instructions in bots.json, no SOUL.md, no home folder for a bot with its own
  // directory. Bob has a SOUL.md already (written since), and Dee had no instructions at all.
  await rm(join(h.botsDir, ada.id, "SOUL.md"));
  await rm(join(h.botsDir, cy.id), { recursive: true });
  await rm(join(h.botsDir, plain.id, "SOUL.md"));
  const file = join(h.dir, "bots.json");
  const stored = JSON.parse(await readFile(file, "utf8")) as { bots: Array<Record<string, unknown>> };
  const legacy: Record<string, string> = { [ada.id]: "You are Ada.\r\nBe brief.", [bob.id]: "Old Bob.", [cy.id]: "You are Cy." };
  stored.bots = stored.bots.map((each) => legacy[String(each["id"])] ? { ...each, instructions: legacy[String(each["id"])] } : each);
  await writeFile(file, JSON.stringify(stored));

  // The store is busy for Ada's conversation the first time: she keeps her field and is finished at the next start.
  const configure = h.conversations.configure.bind(h.conversations);
  let refuse = true;
  h.conversations.configure = async (reference: string, change: unknown) => {
    if (refuse && reference === h.record(ada.sessionId)?.piSessionFile) { refuse = false; throw new Error("store busy"); }
    await configure(reference, change);
  };
  assert.deepEqual(await h.service.migrate(), { souls: 2, cleared: 2 });
  assert.equal(await h.soulFile(ada.id), "You are Ada.\nBe brief.\n", "written before the step that failed");
  assert.equal(await h.soulFile(bob.id), `${SOUL}\n`, "a soul written since is never overwritten");
  assert.equal(await h.soulFile(cy.id), "You are Cy.\n", "in the home folder, made for a bot that works elsewhere");
  assert.equal(await h.soulFile(plain.id), undefined, "a bot with neither gets nothing: its first conversation comes at its next turn");
  const fields = async () => Object.fromEntries((JSON.parse(await readFile(file, "utf8")) as { bots: Array<Record<string, unknown>> }).bots
    .filter((each) => "instructions" in each).map((each) => [each["handle"], each["instructions"]]));
  assert.deepEqual(await fields(), { ada: "You are Ada.\r\nBe brief." }, "only the bot that failed keeps its field");

  // The bot rewrote its SOUL.md before the next start: the second run must not overwrite it.
  await writeFile(join(h.botsDir, ada.id, "SOUL.md"), "# Who I am\nAda, rewritten.\n");
  assert.deepEqual(await h.service.migrate(), { souls: 0, cleared: 1 });
  assert.equal(await h.soulFile(ada.id), "# Who I am\nAda, rewritten.\n");
  assert.deepEqual(await fields(), {});
  assert.deepEqual(h.conversations.configured.map(([reference, change]) => [reference, change]), [
    [h.record(bob.sessionId)?.piSessionFile, { instructions: null }],
    [h.record(cy.sessionId)?.piSessionFile, { instructions: null }],
    [h.record(ada.sessionId)?.piSessionFile, { instructions: null }],
  ], "each conversation's Durable instructions are cleared once");
  assert.deepEqual(await h.service.migrate(), { souls: 0, cleared: 0 }, "idempotent");
  assert.ok(h.chats.every((chat) => chat.prompts.length === 0), "nothing starts a turn");
  // Dee's SOUL.md went by hand above: the list notices within ten seconds (a restarted gateway reads it at once).
  h.advance(10_000);
  assert.deepEqual((await h.service.list()).map((each) => [each.handle, each.soul]), [["ada", true], ["bob", true], ["cy", true], ["dee", false]]);
});

test("the migration to SOUL.md leaves bots on workers alone: their homes and souls are on the worker", async (t) => {
  const h = await harness(t);
  const rover = await h.service.create({ name: "Rover", worker: "w-1", soul: "# Who I am\nRover." });
  const file = join(h.dir, "bots.json");
  const stored = JSON.parse(await readFile(file, "utf8")) as { bots: Array<Record<string, unknown>> };
  stored.bots = stored.bots.map((each) => each["id"] === rover.id ? { ...each, instructions: "Old Rover." } : each);
  await writeFile(file, JSON.stringify(stored));
  const reads = h.remote.soulReads.length;
  assert.deepEqual(await h.service.migrate(), { souls: 0, cleared: 0 });
  assert.equal(existsSync(join(h.botsDir, rover.id)), false, "no home folder for it on this machine");
  assert.deepEqual([h.remote.configured, h.remote.soulReads.length, h.remote.soulFiles.size], [[], reads, 0], "nothing asked of or written to the worker");
});

test("messages prompt an idle bot, queue behind a busy one, and a wait reports the run that answers them", async (t) => {
  const h = await harness(t);
  const bot = await h.service.create({ soul: SOUL, name: "Ada" });
  const chat = await h.chat(bot.sessionId);

  assert.deepEqual(await h.service.send(bot.id, { text: "first" }), { status: "sent" });
  assert.deepEqual(chat.prompts, ["first"]);
  assert.deepEqual(await h.service.send(bot.id, { text: "second" }), { status: "queued" }, "busy: a follow-up, never a refusal");
  const drained = chat.nextPrompt();
  chat.answer("one");
  assert.equal(await drained, "second", "HUI sends the follow-up once the run settles");
  chat.answer("two");

  // Idle, waiting: the answer of the run it started.
  let prompted = chat.nextPrompt();
  const answered = h.service.send(bot.id, { text: "what is 2+2?" }, { timeoutMs: 10_000 });
  await prompted;
  chat.answer("4");
  assert.deepEqual(await answered, { status: "answered", reply: "4" });

  // Busy, waiting: the settle of the run before it is not its answer.
  await h.service.send(bot.id, { text: "slow job" });
  const queued = h.service.send(bot.id, { text: "and then?" }, { timeoutMs: 10_000 });
  await queueHolds(h, bot.sessionId, 1);
  prompted = chat.nextPrompt();
  chat.answer("slow job done");
  assert.equal(await prompted, "and then?");
  chat.answer("then this");
  assert.deepEqual(await queued, { status: "answered", reply: "then this" });

  prompted = chat.nextPrompt();
  const failed = h.service.send(bot.id, { text: "break" }, { timeoutMs: 10_000 });
  await prompted;
  chat.fail("provider exploded");
  assert.deepEqual(await failed, { status: "failed", error: "provider exploded" });

  prompted = chat.nextPrompt();
  const asking = h.service.send(bot.id, { text: "deploy?" }, { timeoutMs: 10_000 });
  await prompted;
  chat.ask({ id: "q1", method: "confirm", title: "Deploy", message: "Ship it to production?" });
  assert.deepEqual(await asking, { status: "needs-input", questions: [{ id: "q1", method: "confirm", title: "Deploy", message: "Ship it to production?" }] });
  chat.questions = [];
  chat.answer("cancelled");

  prompted = chat.nextPrompt();
  const slow = h.service.send(bot.id, { text: "take your time" }, { timeoutMs: 15 });
  await prompted;
  assert.deepEqual(await slow, { status: "timeout" }, "a wait ends; the turn goes on");
  assert.equal(h.sessions.status(bot.sessionId), "running");
  chat.answer("finally");
});

test("a routine is marked as one, queues behind a busy bot and completes with the turn that answers it", async (t) => {
  const h = await harness(t);
  const bot = await h.service.create({ soul: SOUL, name: "Ada" });
  const chat = await h.chat(bot.sessionId);
  const record = h.record(bot.sessionId)!;
  const routine = { name: "Morning", prompt: "check the inbox" };

  let prompted = chat.nextPrompt();
  const idle = h.service.runRoutine((await h.registry.list())[0]!, record, routine, new AbortController().signal);
  assert.equal(await prompted, "[routine: Morning] check the inbox");
  chat.answer("Inbox empty.");
  assert.deepEqual(await idle, { summary: "Inbox empty." });

  await h.service.send(bot.id, { text: "busy work" });
  const behind = h.service.runRoutine((await h.registry.list())[0]!, record, routine, new AbortController().signal);
  await queueHolds(h, bot.sessionId, 1);
  prompted = chat.nextPrompt();
  chat.answer("busy work done");
  assert.equal(await prompted, "[routine: Morning] check the inbox", "a busy bot takes it as a follow-up instead of failing");
  chat.fail("no network");
  await assert.rejects(behind, /no network/u);

  // Cancelled while queued: withdrawn, never sent.
  await h.service.send(bot.id, { text: "more work" });
  const cancel = new AbortController();
  const withdrawn = h.service.runRoutine((await h.registry.list())[0]!, record, routine, cancel.signal);
  await queueHolds(h, bot.sessionId, 1);
  cancel.abort();
  await assert.rejects(withdrawn, (error: unknown) => error instanceof DOMException && error.name === "AbortError");
  assert.deepEqual(h.sessions.snapshot(bot.sessionId).queue.items ?? [], []);
  chat.answer("more work done");
  assert.equal(chat.prompts.filter((text) => text.startsWith("[routine:")).length, 2);

  // Cancelled while it runs: the turn answering it stops.
  const stop = new AbortController();
  prompted = chat.nextPrompt();
  const running = h.service.runRoutine((await h.registry.list())[0]!, record, routine, stop.signal);
  await prompted;
  stop.abort();
  await assert.rejects(running, /cancelled/u);
  assert.equal(chat.aborts, 1);

  await h.service.archive(bot.id);
  await assert.rejects(h.service.runRoutine((await h.registry.list())[0]!, record, routine, new AbortController().signal), /archived/u);
});

test("message_bot delivers to a handle or a name, guards hops, refuses itself and strangers, and rate-limits", async (t) => {
  const h = await harness(t, { messagesPerHour: 3 });
  const ada = await h.service.create({ soul: SOUL, name: "Ada", title: "Researcher" });
  const bob = await h.service.create({ soul: SOUL, name: "Bob" });
  const cy = await h.service.create({ soul: SOUL, name: "Cy" });
  const bobChat = await h.chat(bob.sessionId);
  await h.chat(ada.sessionId);

  assert.deepEqual(await h.service.messageBot(ada.sessionId, { to: "@BOB", message: "  hello  " }), { text: "Queued for @bob.", to: "bob", status: "sent" });
  assert.deepEqual(bobChat.prompts, ["[from @ada] hello"]);
  assert.deepEqual(await h.service.messageBot(ada.sessionId, { to: "bob", message: "again" }), { text: "Queued for @bob.", to: "bob", status: "queued" }, "a busy bot gets a follow-up");
  assert.equal((await h.service.messageBot(ada.sessionId, { to: "cy", message: "by name" })).to, "cy");

  const refusal = async (caller: string, params: Record<string, unknown>, pattern: RegExp) => {
    await assert.rejects(h.service.messageBot(caller, params), (error: unknown) => error instanceof Error && pattern.test(error.message), JSON.stringify(params));
  };
  await refusal(ada.sessionId, { to: "@nobody", message: "x" }, /No bot is called "@nobody"\. Bots you can message: @bob \(Bob\), @cy \(Cy\)\./u);
  await refusal(ada.sessionId, { to: "ada", message: "x" }, /cannot message itself/u);
  await refusal("not-a-bot-session", { to: "bob", message: "x" }, /only available in a bot's chat/u);
  await refusal(ada.sessionId, { to: "bob", message: "" }, /message must be/u);
  await refusal(ada.sessionId, { to: "bob", message: "x".repeat(20_001) }, /message must be/u);
  await refusal(ada.sessionId, { to: "bob", message: "fourth this hour" }, /already sent 3 bot messages in the last hour/u);
  h.advance(3_600_001);

  // The sender's current run started from a bot message: one hop more, refused past the limit.
  const runAs = (prompt: string) => h.setRecords(h.records().map((record) => record.id === ada.sessionId ? { ...record, runPrompt: prompt } : record));
  runAs("[from @cy] can you ask bob?");
  await h.service.messageBot(ada.sessionId, { to: "bob", message: "cy asks" });
  assert.equal(bobChat.prompts.length, 1, "bob is still busy, so it waits in his queue");
  assert.equal(h.sessions.snapshot(bob.sessionId).queue.items?.at(-1)?.text, "[from @ada · hop 2] cy asks");
  runAs("[from @cy · hop 2] and then?");
  await h.service.messageBot(ada.sessionId, { to: "bob", message: "third hop" });
  assert.equal(h.sessions.snapshot(bob.sessionId).queue.items?.at(-1)?.text, `[from @ada · hop ${MAX_BOT_HOPS}] third hop`);
  runAs(`[from @cy · hop ${MAX_BOT_HOPS}] keep going`);
  await refusal(ada.sessionId, { to: "bob", message: "fourth hop" }, /already crossed 3 bots/u);
  runAs("[routine: Morning] check");
  await refusal(ada.sessionId, { to: "Twins", message: "x" }, /No bot is called/u);

  await h.service.create({ soul: SOUL, name: "Twins", handle: "twin-a" });
  await h.service.create({ soul: SOUL, name: "Twins", handle: "twin-b" });
  await refusal(ada.sessionId, { to: "twins", message: "x" }, /2 bots are named "twins"; use a handle/u);
  await h.service.archive("cy");
  await refusal(ada.sessionId, { to: "cy", message: "x" }, /archived/u);
  await refusal(cy.sessionId, { to: "bob", message: "x" }, /archived bot cannot message/u);
});

test("hop markers are read only at the start of a run's input", () => {
  assert.equal(hopOf("[from @ada] hi"), 1);
  assert.equal(hopOf("[from @ada-2 · hop 3] hi"), 3);
  assert.equal(hopOf("hello [from @ada] hi"), undefined);
  assert.equal(hopOf("[routine: x] [from @ada] hi"), undefined);
  assert.equal(hopOf("[from @Ada] hi"), undefined, "handles are lowercase");
  assert.equal(hopOf(undefined), undefined);
});

test("the bots section lists the other active bots by handle and stays byte-identical while the roster does", async (t) => {
  const h = await harness(t);
  const zed = await h.service.create({ soul: SOUL, name: "Zed", title: "Ops" });
  const ada = await h.service.create({ soul: SOUL, name: "Ada", title: "Researcher" });
  const first = await h.service.section(zed.id);
  assert.equal(first, botsSection((await h.registry.list()).find((bot) => bot.id === zed.id)!, [(await h.registry.list()).find((bot) => bot.id === ada.id)!]));
  assert.match(first!, /^You are @zed \(Zed\), one of the bots of this HUI\./u);
  assert.match(first!, /The other bots:\n- @ada: Ada, Researcher\n/u);
  assert.doesNotMatch(first!, /@zed: Zed/u, "not itself");
  assert.match(first!, /\[from @zed\]/u);
  assert.equal(await h.service.section(zed.id), first, "no dates, no state: the cached prefix holds");
  await h.service.update(zed.id, { description: "changes nothing the section shows" });
  assert.equal(await h.service.section(zed.id), first);
  const bob = await h.service.create({ soul: SOUL, name: "Bob" });
  assert.match((await h.service.section(zed.id))!, /- @ada: Ada, Researcher\n- @bob: Bob\n/u);
  await h.service.archive(bob.id);
  await h.service.archive(ada.id);
  assert.match((await h.service.section(zed.id))!, /There are no other bots yet\./u);
  assert.equal(await h.service.section("unknown"), undefined);
});

test("the newest message comes from a live chat, or from one store read while no session holds it", async (t) => {
  const h = await harness(t);
  const bot = await h.service.create({ soul: SOUL, name: "Ada" });
  const record = h.record(bot.sessionId)!;
  // A gateway restart: nothing live, the store answers once.
  h.sessions.disposeAll();
  h.setRecords(h.records().map((each) => each.id === record.id ? { ...each, unread: true } : each));
  const cold = await h.service.get(bot.id);
  assert.deepEqual(cold.lastMessage, { role: "assistant", text: "stored reply", at: "2026-10-01T09:00:00.000Z" });
  assert.equal(cold.unread, true);
  await h.service.get(bot.id);
  assert.deepEqual(h.conversations.lastReads, ["durable:1"], "read once while nothing changes it");
  h.histories.set("durable:1", [{ kind: "message", role: "user", text: "line one\nline two", metrics: { timestamp: Date.parse("2026-10-05T08:00:00.000Z") } }]);
  h.sessions.ensure(h.record(bot.sessionId)!);
  await h.sessions.booted(bot.sessionId);
  assert.deepEqual((await h.service.get(bot.id)).lastMessage, { role: "user", text: "line one line two", at: "2026-10-05T08:00:00.000Z" });
});

test("memory reads go through BotMemory, and a chat whose memory cannot be read says so", async (t) => {
  const h = await harness(t);
  const bot = await h.service.create({ soul: SOUL, name: "Ada" });
  assert.deepEqual(await h.service.memory(bot.id), { status: MEMORY, view: "<chat>\n0+1|user: hi\n</chat>" });
  assert.equal(await h.service.zoom(bot.id, 8, 4), "8+3|user: hi");
  await assert.rejects(h.service.zoom(bot.id, -1, 4), BotInputError);
  assert.match(await h.service.memoryHtml(bot.id), /<title>memory<\/title>/u);

  const plain = await harness(t, { memoryReadable: false });
  const other = await plain.service.create({ soul: SOUL, name: "Bob" });
  assert.equal((await plain.service.get(other.id)).memory, undefined, "the view leaves it out");
  for (const read of [() => plain.service.memory(other.id), () => plain.service.zoom(other.id, 0, 1), () => plain.service.memoryHtml(other.id)]) {
    await assert.rejects(read(), BotMemoryUnavailableError);
  }
});


test("a call's record goes to the bot's conversation as one write, its context carries the memory, and an archived bot takes no call", async (t) => {
  const h = await harness(t);
  const bot = await h.service.create({ name: "Ada", soul: "Be brief." });
  const record: CallRecord = {
    call: "call-1", bot: "Ada", startedAt: 1, endedAt: 60_001, summary: "**To remember**: the sister's birthday is March 3.",
    lines: [{ role: "user", text: "Remember my sister's birthday is March 3.", at: 1 }, { role: "assistant", text: "Got it, March 3.", at: 2 }],
  };
  await h.service.recordCall(bot.handle, record);
  assert.deepEqual(h.conversations.records, [["durable:1", record]]);
  const context = await h.service.callContext(bot.handle);
  assert.equal(context.bot.id, bot.id);
  assert.equal(context.soul, "Be brief.", "the call gets its SOUL.md");
  assert.equal(context.view, "<chat>\n0+1|user: hi\n</chat>");
  const plain = await harness(t, { memoryReadable: false });
  const other = await plain.service.create({ soul: SOUL, name: "Bob" });
  assert.equal((await plain.service.callContext(other.id)).view, undefined, "a call goes on without a memory it cannot read");
  const unsouled = await plain.service.create({ name: "Cy" });
  assert.equal((await plain.service.callContext(unsouled.id)).soul, undefined, "nor a soul it has not written yet");
  await h.service.archive(bot.id);
  await assert.rejects(h.service.callContext(bot.id), BotConflictError);
});

test("a delegation while a turn runs: a task handed off from a call queues behind the running turn and answers with its own reply, never that turn's, beside a call's record", async (t) => {
  const h = await harness(t);
  const bot = await h.service.create({ soul: SOUL, name: "Ada" });
  const chat = await h.chat(bot.sessionId);
  const task = (text: string, signal?: AbortSignal) =>
    h.service.send(bot.id, { text: `[call task] ${text}` }, { timeoutMs: 600_000, ...(signal ? { signal } : {}) });
  const record = { kind: "call" as const, call: "c0", bot: "Ada", startedAt: 1, endedAt: 2, summary: "A record.", lines: [{ role: "assistant" as const, text: "Bye!", at: 2 }] };

  // Idle: a prompt marked as a call task, answered by the run it starts.
  let prompted = chat.nextPrompt();
  const first = task("What's my dog called?");
  assert.equal(await prompted, "[call task] What's my dog called?");
  // An earlier call's record lands while the turn runs: neither the turn's input nor its reply.
  chat.answer("Pancho.");
  chat.history.push(record);
  assert.deepEqual(await first, { status: "answered", reply: "Pancho." });

  // Busy with a typed message: the task queues as a follow-up and waits for its own run, not the one before it.
  await h.service.send(bot.id, { text: "typed while the call runs" });
  const second = task("Check the calendar for tomorrow");
  const third = task("And the weather");
  await queueHolds(h, bot.sessionId, 2);
  prompted = chat.nextPrompt();
  chat.answer("typed reply");
  assert.equal(await prompted, "[call task] Check the calendar for tomorrow");
  prompted = chat.nextPrompt();
  chat.answer("Dentist at ten.");
  assert.equal(await prompted, "[call task] And the weather");
  chat.answer("Sunny, 24 degrees.");
  assert.deepEqual(await second, { status: "answered", reply: "Dentist at ten." }, "never the typed message's reply");
  assert.deepEqual(await third, { status: "answered", reply: "Sunny, 24 degrees." });

  // Hanging up ends the wait, never the turn.
  prompted = chat.nextPrompt();
  const gone = new AbortController();
  const fourth = task("Write the report", gone.signal);
  await prompted;
  gone.abort();
  await assert.rejects(fourth, (error: unknown) => error instanceof DOMException && error.name === "AbortError");
  assert.equal(h.sessions.status(bot.sessionId), "running", "the turn goes on and its reply lands in the chat");
  chat.answer("Report written.");
});

test("the bots section tells the bot how calls reach it", async (t) => {
  const h = await harness(t);
  const ada = await h.service.create({ soul: SOUL, name: "Ada" });
  const section = await h.service.section(ada.id);
  assert.match(section!, /"\[call task\]"/u);
  assert.match(section!, /After each call your chat and memory get its record, marked "\[call\]": a summary and the whole transcript\./u);
});

/* ── bots on remote workers ─────────────────────────────────────────────── */

const REMOTE_MEMORY: BotMemoryStatus = { ...MEMORY, messages: 9 };
/** The gateway's skill /skills/alpha as devbox finds it, mirrored there. */
const REMOTE_ALPHA = "/home/remote/.local/share/hui-worker/mirror/agent/skills/alpha/SKILL.md";

test("a worker's skills match by name and mirrored path: a skill this gateway names by its own path finds the one the worker mirrors", () => {
  const offer = {
    tools: [], alwaysOn: [], live: true,
    skills: [{ name: "alpha", path: REMOTE_ALPHA, description: "Alpha.", source: "~/.local/share/hui-worker/mirror/agent/skills" }],
  };
  const alias = (path: string) => path.startsWith("/skills/") ? `/home/remote/.local/share/hui-worker/mirror/agent${path}` : undefined;
  const none = { disabledTools: [], disabledSkills: [] };
  const alpha = { name: "alpha", path: REMOTE_ALPHA };
  assert.deepEqual(resolveAccess(offer, none, { disabledSkills: [{ name: "alpha", path: "/skills/alpha/SKILL.md" }] }, alias).disabledSkills, [alpha]);
  assert.deepEqual(resolveAccess(offer, none, { disabledSkills: [alpha, "alpha"] }, alias).disabledSkills, [alpha], "the worker's own path, or the name, too");
  assert.throws(() => resolveAccess(offer, none, { disabledSkills: [{ name: "alpha", path: "/skills/alpha/SKILL.md" }] }), /Unknown skill: alpha \(\/skills\/alpha\/SKILL\.md\)/u, "without the worker's naming, a path here is no skill there");
  assert.throws(() => resolveAccess(offer, none, { disabledSkills: [{ name: "beta", path: "/skills/alpha/SKILL.md" }] }, alias), /Unknown skill: beta/u, "the name must match too");
  // Already off and no longer offered there: it may stay off under either path.
  const off = { disabledTools: [], disabledSkills: [{ name: "gone", path: "/home/remote/.local/share/hui-worker/mirror/agent/skills/gone/SKILL.md" }] };
  assert.deepEqual(resolveAccess(offer, off, { disabledSkills: [{ name: "gone", path: "/skills/gone/SKILL.md" }] }, alias).disabledSkills, off.disabledSkills);
});

test("a bot on a worker keeps its lists there: created with them, listed and checked there, its skills by the worker's paths, and refused naming the worker while it is offline", async (t) => {
  const h = await harness(t);
  const alpha = { name: "alpha", path: REMOTE_ALPHA };
  // At creation, against the worker's own offer: no conversation yet, so its home there (or the folder asked for).
  const rover = await h.service.create({ name: "Rover", worker: "devbox", soul: "# Who I am\nRover.", disabledTools: ["bash"], disabledSkills: ["alpha"] });
  assert.deepEqual(h.remote.offers, [[undefined, undefined, rover.id]]);
  assert.deepEqual((h.remote.created[0]!.input as BotConversationInput).access, { disabledTools: ["bash"], disabledSkills: [alpha] }, "in the creating commit there");
  assert.deepEqual([rover.disabledTools, rover.disabledSkills], [["bash"], [alpha]], "and the roster's copy");
  assert.deepEqual([h.conversations.offers, h.conversations.created], [[], []], "nothing asked of this gateway's store");
  const placed = await h.service.create({ name: "Placed", worker: "devbox", cwd: "~/src", disabledTools: ["read"] });
  assert.deepEqual(h.remote.offers.at(-1), [undefined, "~/src", placed.id], "or the folder asked for, checked there");
  await assert.rejects(h.service.create({ name: "Early", worker: "devbox", disabledTools: ["remote_echo"] }), /Unknown tool: remote_echo\. Tools you can turn off: read, bash, message_bot\. An extension's tools can be turned off once the bot's chat runs\.$/u);
  assert.equal(h.remote.created.length, 2, "a refused list creates nothing there");

  // Its catalog: the worker's offer (its running chat's, with its extension's tool) and the lists in its document there.
  // (This harness can't open a chat on a worker; bot-workers.test.ts edits a real one's lists.)
  const reference = h.record(rover.sessionId)!.piSessionFile!;
  h.remote.lists.set(reference, { disabledTools: ["remote_echo", "bash"], disabledSkills: [alpha] });
  const catalog = await h.service.catalog(rover.id);
  assert.deepEqual(catalog.tools.map((tool) => [tool.name, tool.enabled]), [["read", true], ["bash", false], ["message_bot", true], ["remote_echo", false]]);
  assert.deepEqual([catalog.skills.map((skill) => [skill.path, skill.enabled]), catalog.live], [[[REMOTE_ALPHA, false]], true]);
  assert.deepEqual([(await h.service.get(rover.id)).disabledTools, h.conversations.lists.size], [["remote_echo", "bash"], 0], "the roster follows; this gateway's store is untouched");

  // HUI's own check reads the document there: a grant the roster missed is not refused.
  await assert.rejects(h.service.checkToolAllowed(rover.sessionId, "bash"), BotConflictError);
  h.remote.lists.set(reference, { disabledTools: ["remote_echo"], disabledSkills: [alpha] });
  await h.service.checkToolAllowed(rover.sessionId, "bash");
  assert.deepEqual((await h.service.get(rover.id)).disabledTools, ["remote_echo"]);

  // The gateway's start reads no worker: its conversation is in the worker's store.
  h.remote.lists.set(reference, { disabledTools: ["bash"], disabledSkills: [] });
  assert.equal(await h.service.reconcileAccess(), 0);
  assert.deepEqual((await h.service.get(rover.id)).disabledTools, ["remote_echo"]);

  // Offline: its catalog and an edit of its lists are refused naming the worker, and HUI's check refuses.
  h.remote.online = false;
  await assert.rejects(h.service.catalog(rover.id), (error: unknown) => error instanceof BotWorkerOfflineError && /devbox/u.test(error.message));
  await assert.rejects(h.service.update(rover.id, { disabledTools: [] }), BotWorkerOfflineError);
  await assert.rejects(h.service.checkToolAllowed(rover.sessionId, "remote_echo"), BotConflictError, "off in the roster's copy, and its document can't say otherwise");
  await assert.rejects(h.service.create({ name: "Late", worker: "devbox", disabledTools: ["bash"] }), BotWorkerOfflineError);
});

test("a grant made on a worker reaches the roster, for a bot that runs there only, and each connection to the worker checks its bots' lists there", async (t) => {
  const h = await harness(t);
  const alpha = { name: "alpha", path: REMOTE_ALPHA };
  const rover = await h.service.create({ name: "Rover", worker: "devbox", soul: "# Who I am\nRover.", disabledTools: ["bash", "read"] });
  const reference = h.record(rover.sessionId)!.piSessionFile!;
  for (const listener of h.remote.granted) listener("w-2", rover.id, { disabledTools: [], disabledSkills: [] });
  for (const listener of h.remote.granted) listener("w-1", "someone-else", { disabledTools: [], disabledSkills: [] });
  for (const listener of h.remote.granted) listener("w-1", rover.id, { disabledTools: ["read"], disabledSkills: [alpha] });
  await waitFor(async () => (await h.service.get(rover.id)).disabledTools?.join() === "read" || undefined, "the reported grant");
  assert.deepEqual((await h.service.get(rover.id)).disabledSkills, [alpha]);
  // A grant the roster missed (the connection dropped as the operator answered): the next connection copies it.
  h.remote.lists.set(reference, { disabledTools: [], disabledSkills: [] });
  for (const listener of h.remote.connected) listener("w-1");
  await waitFor(async () => "disabledTools" in await h.service.get(rover.id) ? undefined : true, "the reconnect's check");
  assert.equal("disabledSkills" in await h.service.get(rover.id), false);
  await waitFor(() => h.reports.find((event) => event.action === "bots_access_reconciled"), "the reconnect's report");
  assert.deepEqual(h.reports.map(({ level, action, summary }) => [level, action, summary]), [["info", "bots_access_reconciled", "1 bot's tool and skill lists on devbox were copied again from their chats"]]);
  // A worker gone again meanwhile leaves the copy for the next connection, with no warning.
  h.remote.online = false;
  for (const listener of h.remote.connected) listener("w-1");
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(h.reports.length, 1);
});

test("a bot created on a worker gets its conversation, memory and folder there, and its chat is a session on that worker", async (t) => {
  const h = await harness(t);
  const view = await h.service.create({ name: "Rover", worker: "devbox", soul: "# Who I am\nRover.", model: "fixture/one", memoryModel: "fixture/cheap" });
  assert.deepEqual(view.worker, { id: "w-1", name: "devbox" }, "named as session views name it");
  assert.equal(view.cwd, `/home/remote/.local/share/hui-worker/bots/${view.id}`, "its home, which the worker made");
  assert.equal(view.soul, true, "known from the create: the list does not wait for the worker to say");
  // Its home, SOUL.md and conversation in one operation there.
  assert.deepEqual(h.remote.created, [{ worker: "w-1", input: { botId: view.id, model: "fixture/one", soul: "# Who I am\nRover.", memory: { name: "Rover", model: "fixture/cheap" } } }]);
  assert.deepEqual(h.conversations.created, [], "nothing in this gateway's store");
  assert.equal(existsSync(join(h.botsDir, view.id)), false, "no home folder, and so no SOUL.md, on this machine");
  assert.deepEqual(h.created, [{
    body: { cwd: view.cwd, title: "Rover", group: "", tool: "durable", worker: "w-1", model: "fixture/one" },
    bot: { id: view.id, piSessionFile: "durable:101" },
  }], "its chat is registered through New Session's path, on the worker");
  assert.equal(h.record(view.sessionId)?.worker, "w-1");
  assert.equal((await h.registry.list()).find((bot) => bot.id === view.id)?.worker, "w-1", "bots.json keeps the worker's id");
  assert.equal(botDisplayCwd(view), `devbox:/home/remote/.local/share/hui-worker/bots/${view.id}`);

  // A directory it names is checked there; one that cannot be a path on a worker is refused here.
  assert.equal((await h.service.create({ name: "Placed", worker: "w-1", cwd: "~/src" })).cwd, "/home/remote/src");
  await assert.rejects(h.service.create({ name: "Lost", worker: "w-1", cwd: "src" }), /A directory on a worker must be absolute or start with ~\//u);
  await assert.rejects(h.service.create({ name: "Nowhere", worker: "nope" }), /No worker named nope/u);
  assert.equal(h.remote.created.length, 2, "refused creates reach no worker");

  // Where a bot runs is chosen once.
  await assert.rejects(h.service.update(view.id, { worker: "w-1" }), (error: unknown) => error instanceof BotInputError && error.message === "A bot stays on the machine it was created on.");
  await assert.rejects(h.service.update(view.id, { title: "Scout", worker: "" }), /stays on the machine it was created on/u);
});

test("a bot on a worker is edited, called and remembered in its worker's store; model checks stay here", async (t) => {
  const h = await harness(t);
  const rover = await h.service.create({ name: "Rover", worker: "w-1", soul: "# Who I am\nRover." });
  const reference = h.record(rover.sessionId)!.piSessionFile!;
  await h.service.update(rover.id, { name: "Rover Two", memoryModel: "fixture/cheap" });
  assert.deepEqual(h.remote.configured, [], "nothing changes in its conversation: no instructions any more");
  assert.deepEqual(h.remote.memoryCalls, [["configure", reference, { name: "Rover Two", model: "fixture/cheap" }]]);
  assert.deepEqual([h.conversations.configured, h.memoryCalls], [[], []], "this gateway's store is untouched");
  await assert.rejects(h.service.update(rover.id, { memoryModel: "other/model" }), /Unknown model: other\/model/u);
  // A directory is checked on the worker; the same one is no move.
  assert.equal((await h.service.update(rover.id, { cwd: rover.cwd })).cwd, rover.cwd);
  assert.deepEqual(h.remote.directories, [rover.cwd]);
  await assert.rejects(h.service.update(rover.id, { cwd: "relative/dir" }), /absolute or start with ~\//u);

  const record: CallRecord = { call: "call-9", bot: "Rover", startedAt: 1, endedAt: 60_001, lines: [{ role: "user", text: "Where are you?", at: 1 }] };
  await h.service.recordCall(rover.id, record);
  assert.deepEqual(h.remote.records, [["w-1", reference, record]]);
  assert.deepEqual(h.conversations.records, []);
  // SOUL.md is read and written in its home on the worker: its Soul tab and its calls.
  h.remote.soulFiles.set(rover.id, "# Who I am\nRover, on devbox.");
  assert.equal(await h.service.soul(rover.id), "# Who I am\nRover, on devbox.");
  assert.equal(await h.service.setSoul(rover.id, "# Who I am\r\nRover Two.\n"), "# Who I am\nRover Two.");
  assert.equal(h.remote.soulFiles.get(rover.id), "# Who I am\nRover Two.");
  assert.equal((await h.service.get(rover.id)).soul, true);
  assert.equal(await h.service.setSoul(rover.id, ""), null, "an empty soul removes it there");
  assert.equal(h.remote.soulFiles.has(rover.id), false);
  assert.equal((await h.service.get(rover.id)).soul, false, "known at once, not read again from a list");
  await h.service.setSoul(rover.id, "# Who I am\nRover Two.");
  assert.deepEqual(await h.service.callContext(rover.id), {
    bot: (await h.registry.list()).find((bot) => bot.id === rover.id), view: "<chat>\n0+1|user: from the worker\n</chat>", soul: "# Who I am\nRover Two.",
  }, "a call starts from the soul on the worker");
  assert.equal(existsSync(join(h.botsDir, rover.id)), false, "never a SOUL.md on this machine");
  h.remote.online = false;
  await assert.rejects(h.service.soul(rover.id), BotWorkerOfflineError);
  await assert.rejects(h.service.setSoul(rover.id, "x"), BotWorkerOfflineError);
  assert.equal((await h.service.callContext(rover.id)).soul, undefined, "a call goes on without it");
  h.remote.online = true;
  assert.equal((await h.service.callContext(rover.id)).view, "<chat>\n0+1|user: from the worker\n</chat>");
  assert.deepEqual(await h.service.memory(rover.id), { status: REMOTE_MEMORY, view: "<chat>\n0+1|user: from the worker\n</chat>" });
  assert.equal(await h.service.zoom(rover.id, 4, 2), "4+1|user: from the worker");
  assert.match(await h.service.memoryHtml(rover.id), /remote memory/u);
});

test("a bot list never waits on a worker: memory from its last report, the newest message read once per connection in the background", async (t) => {
  const h = await harness(t);
  let release!: () => void;
  h.remote.hold = new Promise<void>((resolve) => { release = resolve; });
  const rover = await h.service.create({ name: "Rover", worker: "w-1" });
  const first = (await h.service.list()).find((bot) => bot.id === rover.id)!;
  assert.equal(first.lastMessage, undefined, "the read is still out: the list did not wait for it");
  assert.deepEqual(first.memory, REMOTE_MEMORY);
  assert.equal(h.remote.lastReads.length, 1);
  await h.service.list();
  assert.equal(h.remote.lastReads.length, 1, "one read in flight at a time");
  release();
  await waitFor(async () => (await h.service.get(rover.id)).lastMessage, "the background read");
  assert.deepEqual((await h.service.get(rover.id)).lastMessage, { role: "assistant", text: "remote reply", at: "2026-10-06T21:00:00.000Z" });
  for (let index = 0; index < 3; index += 1) await h.service.list();
  assert.equal(h.remote.lastReads.length, 1, "cached for this connection");
  // The worker's runs went on while HUI was away: a new connection reads it again.
  for (const listener of h.remote.connected) listener("w-1");
  await h.service.list();
  assert.equal(h.remote.lastReads.length, 2);

  // Offline: the list still answers at once, with the chat's state and no memory.
  h.remote.online = false;
  const away = (await h.service.list()).find((bot) => bot.id === rover.id)!;
  assert.equal(away.memory, undefined);
  assert.equal(away.worker?.name, "devbox");
});

test("an offline worker: creating there fails naming it, its bots' memory says it is offline, and messages fail clearly", async (t) => {
  const h = await harness(t);
  h.remote.online = false;
  await assert.rejects(h.service.create({ name: "Late", worker: "w-1" }), (error: unknown) => error instanceof BotWorkerOfflineError && /HUI is not connected to devbox/u.test(error.message));
  assert.deepEqual([h.created, await h.registry.list()], [[], []], "nothing is left behind");
  h.remote.online = true;
  const rover = await h.service.create({ name: "Rover", worker: "w-1" });
  h.remote.online = false;
  for (const read of [() => h.service.memory(rover.id), () => h.service.zoom(rover.id, 0, 1), () => h.service.memoryHtml(rover.id)]) {
    await assert.rejects(read(), (error: unknown) => error instanceof BotWorkerOfflineError && /devbox, where this bot runs, is offline/u.test(error.message));
  }
  assert.equal((await h.service.callContext(rover.id)).view, undefined, "a call goes on without the memory");
  // This gateway has no such worker configured, so the chat's session cannot reach it, as a remote session's could not.
  await waitFor(() => h.sessions.status(rover.sessionId) === "disconnected" || undefined, "the chat to show the disconnect");
  assert.equal((await h.service.get(rover.id)).status, "disconnected");
  await assert.rejects(h.service.send(rover.id, { text: "hello?" }), (error: unknown) => error instanceof BotWorkerOfflineError && /runs on devbox, which HUI is disconnected from/u.test(error.message));
});

test("deleting a bot on a worker cleans up there at once, or queues it while the worker is offline; it leaves the roster either way", async (t) => {
  const h = await harness(t);
  const rover = await h.service.create({ name: "Rover", worker: "w-1", soul: "# Who I am\nRover." });
  const crow = await h.service.create({ name: "Crow", worker: "w-1", cwd: "~/src/crow" });
  const [roverRef, crowRef] = h.remote.created.map((_, index) => `durable:${101 + index}`);
  assert.deepEqual(await h.service.delete(rover.id), { queued: false });
  assert.deepEqual(h.remote.cleanups, [{ worker: "w-1", botId: rover.id, reference: roverRef, cwd: "/home/remote/.local/share/hui-worker/bots/" + rover.id, queued: false }]);
  assert.equal(await h.soulFile(rover.id), undefined, "nothing of it on this machine");
  h.remote.online = false;
  // An offline worker: its chat cannot be reached, and the bot still goes at once.
  assert.deepEqual(await h.service.delete(crow.id), { queued: true });
  assert.deepEqual(h.remote.cleanups.at(-1), { worker: "w-1", botId: crow.id, reference: crowRef, cwd: "/home/remote/src/crow", queued: true }, "with the folder it worked in, so the worker never removes a chosen one");
  assert.deepEqual(await h.registry.list(), []);
  assert.deepEqual(h.remote.forgotten, [], "the worker forgets its conversations itself, in the clean-up");
});

test("a worker's host gets the bots section only for a bot that runs on it", async (t) => {
  const h = await harness(t);
  const home = await h.service.create({ name: "Home" });
  const rover = await h.service.create({ name: "Rover", worker: "w-1" });
  const section = await h.service.workerSection("w-1", rover.id);
  assert.match(section!, /You are @rover \(Rover\)/u);
  assert.match(section!, /- @home: Home/u, "the roster includes the bots here");
  await assert.rejects(h.service.workerSection("w-1", home.id), BotNotFoundError);
  await assert.rejects(h.service.workerSection("w-2", rover.id), BotNotFoundError);
});
