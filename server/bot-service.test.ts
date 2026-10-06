import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";

import type { BotMemoryStatus } from "../shared/bots.ts";
import type { CallRecord } from "../shared/calls.ts";
import type { AutomationTask } from "../src/lib/automation-types.ts";
import { DEFAULT_SETTINGS } from "../src/lib/settings.ts";
import type { BotMemory } from "./bot-memory.ts";
import type { AgentRuntime, PromptAttachment, RuntimeEvent, RuntimeModel, RuntimeQuestion, RuntimeSession, StartOptions, TranscriptEntry } from "./runtimes/types.ts";

// Paths are resolved at import time: never the operator's own configuration.
process.env["XDG_CONFIG_HOME"] = await mkdtemp(join(tmpdir(), "hui-bot-service-config-"));
const { LiveSessions } = await import("./live-sessions.ts");
const { BotRegistry, BotConflictError, BotInputError, BotNotFoundError } = await import("./bots.ts");
const { BotService, botsSection, hopOf, MAX_BOT_HOPS } = await import("./bot-service.ts");
const { BotMemoryUnavailableError } = await import("./bot-memory.ts");
type SessionRecord = import("./sessions.ts").SessionRecord;
type BotConversationInput = import("./bot-service.ts").BotConversationInput;

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
      return `durable:${this.next++}`;
    },
    async configure(reference: string, change: unknown) { this.configured.push([reference, change]); },
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
  };
  const memoryCalls: Array<[string, ...unknown[]]> = [];
  // A memory the gateway cannot read (no OptChat for the chat) answers nothing and refuses every read.
  const readable = options.memoryReadable !== false;
  const unreadable = async (): Promise<never> => { throw new BotMemoryUnavailableError(); };
  const memory: BotMemory = {
    enable: async () => {},
    configure: async (reference, settings) => { memoryCalls.push(["configure", reference, settings]); },
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
    routines: {
      tasks: async () => tasks,
      disable: async (task) => {
        const index = tasks.findIndex((each) => each.id === task.id);
        tasks[index] = { ...task, enabled: false, nextRunAt: null };
      },
    },
    botsDir,
    now: () => clock,
    ...(options.messagesPerHour ? { messagesPerHour: options.messagesPerHour } : {}),
  });
  return {
    dir, botsDir, sessions, service, registry, conversations, memoryCalls, tasks, created, removed, chats, histories,
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

test("creating a bot makes its conversation with persona and memory, then its chat through New Session's path, then the bot", async (t) => {
  const h = await harness(t);
  const view = await h.service.create({
    name: "Ada Lovelace", title: "Researcher", instructions: "Answer in one paragraph.", model: "fixture/one", thinking: "high",
    memoryModel: "fixture/cheap", memoryThinking: "low", avatar: { emoji: "🦊" },
  });
  assert.equal(view.handle, "ada-lovelace");
  assert.equal(view.name, "Ada Lovelace");
  assert.equal(view.cwd, join(h.botsDir, view.id), "its own directory by default");
  assert.equal((await stat(view.cwd)).mode & 0o777, 0o700);
  assert.deepEqual(h.conversations.created, [{
    botId: view.id, cwd: view.cwd, model: "fixture/one", thinking: "high", instructions: "Answer in one paragraph.",
    memory: { name: "Ada Lovelace", model: "fixture/cheap", thinking: "low" },
  }], "persona and OptChat go into the conversation's creating commit");
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

  const twin = await h.service.create({ name: "Ada Lovelace" });
  assert.equal(twin.handle, "ada-lovelace-2");
  await assert.rejects(h.service.create({ name: "Other", handle: "ada-lovelace" }), BotConflictError);
  assert.equal(h.created.length, 2, "a refused handle creates nothing");
  const cwd = join(h.dir, "workspace");
  await mkdir(cwd);
  assert.equal((await h.service.create({ name: "Placed", cwd })).cwd, cwd);
  await assert.rejects(h.service.create({ name: "Lost", cwd: join(h.dir, "missing") }), /No such directory/u);
  assert.deepEqual((await h.service.list()).map((bot) => bot.handle), ["ada-lovelace", "ada-lovelace-2", "placed"]);
});

test("a create that fails part-way leaves no half bot behind", async (t) => {
  const h = await harness(t);
  h.conversations.failCreate = new BotInputError("Unknown model: nope/nope");
  await assert.rejects(h.service.create({ name: "Broken" }), /Unknown model/u);
  h.conversations.failCreate = undefined;
  h.failCreateSession(new Error("registry is read-only"));
  await assert.rejects(h.service.create({ name: "Broken" }), /read-only/u);
  h.failCreateSession(undefined);
  assert.deepEqual(await h.service.list(), []);
  assert.deepEqual(h.records(), []);

  // The bot record itself fails to write: its chat's session record goes again.
  await h.registry.update(() => ({ bots: [], result: undefined }));
  const original = h.registry.update.bind(h.registry);
  let refuse = true;
  h.registry.update = ((mutate) => refuse ? Promise.reject(new Error("disk full")) : original(mutate)) as typeof h.registry.update;
  await assert.rejects(h.service.create({ name: "Broken" }), /disk full/u);
  refuse = false;
  assert.equal(h.removed.length, 1);
  assert.deepEqual(h.records(), []);
  const { readdir } = await import("node:fs/promises");
  assert.deepEqual(await readdir(h.botsDir), [], "the directories made for the failed bots are gone");
});

test("editing a bot propagates to its chat, its conversation and its memory", async (t) => {
  const h = await harness(t);
  const bot = await h.service.create({ name: "Ada", instructions: "Old persona." });
  const chat = await h.chat(bot.sessionId);
  const edited = await h.service.update(bot.handle, {
    name: "Ada Prime", title: "Lead", instructions: "New persona.", model: "fixture/two", thinking: "low",
    memoryModel: "fixture/cheap", avatar: { color: "#112233" }, hidden: true,
  });
  assert.equal(edited.handle, "ada", "renaming keeps the handle");
  assert.equal(edited.name, "Ada Prime");
  assert.deepEqual(edited.avatar, { color: "#112233" });
  assert.equal(edited.hidden, true);
  assert.deepEqual(chat.model, { provider: "fixture", id: "two", name: "two" }, "the model changes through the live chat");
  assert.equal(chat.thinking, "low");
  assert.equal(h.record(bot.sessionId)?.model, "fixture/two", "and persists like the session's own control");
  assert.equal(h.record(bot.sessionId)?.title, "Ada Prime");
  assert.deepEqual(h.conversations.configured, [["durable:1", { instructions: "New persona." }]]);
  assert.deepEqual(h.memoryCalls, [["configure", "durable:1", { name: "Ada Prime", model: "fixture/cheap" }]]);

  await h.service.update(bot.id, { instructions: "", memoryModel: "", handle: "prime" });
  assert.deepEqual(h.conversations.configured.at(-1), ["durable:1", { instructions: null }], "an empty persona clears it");
  assert.deepEqual(h.memoryCalls.at(-1), ["configure", "durable:1", { name: "Ada Prime" }]);
  const current = await h.service.get("prime");
  assert.equal(current.instructions, undefined);
  assert.equal(current.memoryModel, undefined);
  await h.service.create({ name: "Bob" });
  await assert.rejects(h.service.update("prime", { handle: "bob" }), BotConflictError);
  await assert.rejects(h.service.update("prime", { memoryModel: "elsewhere/model" }), /Unknown model/u);
  await assert.rejects(h.service.update("prime", { nickname: "x" }), BotInputError);
  await assert.rejects(h.service.update("nobody", { title: "x" }), BotNotFoundError);
});

test("clearing a bot's model or thinking puts its chat back on what a new chat gets, and keeps no choice", async (t) => {
  const h = await harness(t);
  const bot = await h.service.create({ name: "Ada", model: "fixture/two", thinking: "high" });
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
  const bot = await h.service.create({ name: "Ada" });
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
  const bot = await h.service.create({ name: "Ada" });
  const other = await h.service.create({ name: "Bob" });
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

test("messages prompt an idle bot, queue behind a busy one, and a wait reports the run that answers them", async (t) => {
  const h = await harness(t);
  const bot = await h.service.create({ name: "Ada" });
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
  const bot = await h.service.create({ name: "Ada" });
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
  const ada = await h.service.create({ name: "Ada", title: "Researcher" });
  const bob = await h.service.create({ name: "Bob" });
  const cy = await h.service.create({ name: "Cy" });
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

  await h.service.create({ name: "Twins", handle: "twin-a" });
  await h.service.create({ name: "Twins", handle: "twin-b" });
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
  const zed = await h.service.create({ name: "Zed", title: "Ops" });
  const ada = await h.service.create({ name: "Ada", title: "Researcher" });
  const first = await h.service.section(zed.id);
  assert.equal(first, botsSection((await h.registry.list()).find((bot) => bot.id === zed.id)!, [(await h.registry.list()).find((bot) => bot.id === ada.id)!]));
  assert.match(first!, /^You are @zed \(Zed\), one of the bots of this HUI\./u);
  assert.match(first!, /The other bots:\n- @ada: Ada, Researcher\n/u);
  assert.doesNotMatch(first!, /@zed: Zed/u, "not itself");
  assert.match(first!, /\[from @zed\]/u);
  assert.equal(await h.service.section(zed.id), first, "no dates, no state: the cached prefix holds");
  await h.service.update(zed.id, { description: "changes nothing the section shows" });
  assert.equal(await h.service.section(zed.id), first);
  const bob = await h.service.create({ name: "Bob" });
  assert.match((await h.service.section(zed.id))!, /- @ada: Ada, Researcher\n- @bob: Bob\n/u);
  await h.service.archive(bob.id);
  await h.service.archive(ada.id);
  assert.match((await h.service.section(zed.id))!, /There are no other bots yet\./u);
  assert.equal(await h.service.section("unknown"), undefined);
});

test("the newest message comes from a live chat, or from one store read while no session holds it", async (t) => {
  const h = await harness(t);
  const bot = await h.service.create({ name: "Ada" });
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
  const bot = await h.service.create({ name: "Ada" });
  assert.deepEqual(await h.service.memory(bot.id), { status: MEMORY, view: "<chat>\n0+1|user: hi\n</chat>" });
  assert.equal(await h.service.zoom(bot.id, 8, 4), "8+3|user: hi");
  await assert.rejects(h.service.zoom(bot.id, -1, 4), BotInputError);
  assert.match(await h.service.memoryHtml(bot.id), /<title>memory<\/title>/u);

  const plain = await harness(t, { memoryReadable: false });
  const other = await plain.service.create({ name: "Bob" });
  assert.equal((await plain.service.get(other.id)).memory, undefined, "the view leaves it out");
  for (const read of [() => plain.service.memory(other.id), () => plain.service.zoom(other.id, 0, 1), () => plain.service.memoryHtml(other.id)]) {
    await assert.rejects(read(), BotMemoryUnavailableError);
  }
});


test("a call's record goes to the bot's conversation as one write, its context carries the memory, and an archived bot takes no call", async (t) => {
  const h = await harness(t);
  const bot = await h.service.create({ name: "Ada", instructions: "Be brief." });
  const record: CallRecord = {
    call: "call-1", bot: "Ada", startedAt: 1, endedAt: 60_001, summary: "**To remember**: the sister's birthday is March 3.",
    lines: [{ role: "user", text: "Remember my sister's birthday is March 3.", at: 1 }, { role: "assistant", text: "Got it, March 3.", at: 2 }],
  };
  await h.service.recordCall(bot.handle, record);
  assert.deepEqual(h.conversations.records, [["durable:1", record]]);
  const context = await h.service.callContext(bot.handle);
  assert.equal(context.bot.id, bot.id);
  assert.equal(context.bot.instructions, "Be brief.");
  assert.equal(context.view, "<chat>\n0+1|user: hi\n</chat>");
  const plain = await harness(t, { memoryReadable: false });
  const other = await plain.service.create({ name: "Bob" });
  assert.equal((await plain.service.callContext(other.id)).view, undefined, "a call goes on without a memory it cannot read");
  await h.service.archive(bot.id);
  await assert.rejects(h.service.callContext(bot.id), BotConflictError);
});

test("a task handed off from a call answers with its own reply, even queued behind a running turn and beside a call's record", async (t) => {
  const h = await harness(t);
  const bot = await h.service.create({ name: "Ada" });
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
  const ada = await h.service.create({ name: "Ada" });
  const section = await h.service.section(ada.id);
  assert.match(section!, /"\[call task\]"/u);
  assert.match(section!, /After each call your chat and memory get its record, marked "\[call\]": a summary and the whole transcript\./u);
});
