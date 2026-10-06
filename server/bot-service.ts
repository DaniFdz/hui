/**
 * Bots (HUI-18): create, edit, archive, delete and talk to them.
 *
 * A bot's chat is an ordinary Durable session registered through New
 * Session's code path, and its record carries `bot`; the bot registry
 * (`bots.ts`) owns the rest. Durable and OptChat arrive through two injected
 * ports, so the lifecycle is tested without a harness: `BotConversations` (the
 * conversation, its instructions and directory; `bot-conversations.ts`) and
 * `BotMemory` (OptChat; `bot-memory.ts`).
 *
 * Delivery follows the composer: a prompt while the chat is idle, a follow-up
 * while it works. A waiting caller resolves when the run that answers its
 * message settles, which for a follow-up is the run HUI starts once it drains
 * that message from its queue.
 */
import { randomUUID } from "node:crypto";
import { mkdir, rmdir, stat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

import {
  BOT_LIMITS, handleFromName, previewLine,
  type BotLastMessage, type BotMemoryStatus, type BotMessageResult, type BotPatch, type BotQuestion, type BotRecord, type BotReply, type BotView,
} from "../shared/bots.ts";
import type { AutomationTask } from "../src/lib/automation-types.ts";
import { BotMemoryUnavailableError, type BotMemory, type BotMemorySettings } from "./bot-memory.ts";
import {
  BOTS_DIR, BotConflictError, BotInputError, BotNotFoundError, findBot, normalizeBotInput, normalizeBotPatch, patchedAvatar, uniqueHandle,
  type BotRegistry,
} from "./bots.ts";
import { SessionBusyError, type LiveSessions } from "./live-sessions.ts";
import type { PromptAttachment, RuntimeQuestion, TranscriptEntry } from "./runtimes/types.ts";
import type { SessionRecord } from "./sessions.ts";
import { resolveWorkingDirectory } from "./working-directories.ts";

/** `message_bot` messages one bot may send per hour: a backstop behind the hop guard. */
const MESSAGES_PER_HOUR = 30;
const HOUR_MS = 3_600_000;
/** Bot-to-bot messages a chain may cross before HUI stops it. */
export const MAX_BOT_HOPS = 3;
const READY_TIMEOUT_MS = 60_000;
const HOP = /^\[from @[a-z0-9-]+(?: · hop ([1-9]\d*))?\] /u;

export type BotSessions = Pick<
  LiveSessions,
  "ensure" | "status" | "watch" | "snapshot" | "transcript" | "isLive" | "prompt" | "followUp" | "removeFollowUp" | "abort" | "setModel" | "setThinking" | "restart"
>;

/** A message read from the store for a chat no session has loaded; `at` when its message carries a time. */
export type BotStoredMessage = { role: "user" | "assistant"; text: string; at?: string };

export type BotConversationInput = {
  botId: string;
  cwd: string;
  model?: string;
  thinking?: string;
  instructions?: string;
  memory: BotMemorySettings;
};

/** The Durable side of bots' chats. */
export type BotConversations = {
  /** One commit: the conversation, its agent (cwd, model, thinking, instructions), its bot document and OptChat. Returns its resume reference. */
  create(input: BotConversationInput): Promise<string>;
  /** Takes effect at the conversation's next request. `instructions: null` clears them. */
  configure(reference: string, change: { instructions?: string | null; cwd?: string }): Promise<void>;
  lastMessage(reference: string): Promise<BotStoredMessage | undefined>;
  /** Rejects a `provider/id` this gateway cannot resolve. */
  checkModel(model: string): Promise<void>;
  /** The model a new chat in `cwd` starts on (PI's default there, else the first available), as `provider/id`. */
  defaultModel(cwd: string): Promise<string | undefined>;
  /** The thinking level a new chat in `cwd` starts at on `model`: PI's default fitted to the model, else `off`. */
  defaultThinking(cwd: string, model: string | undefined): Promise<string>;
};

/** Automation tasks, which are a bot's routines when they target its chat. */
export type BotRoutines = {
  tasks(): Promise<readonly AutomationTask[]>;
  disable(task: AutomationTask): Promise<void>;
  /** Deletes a routine of a bot that is deleted. */
  remove(task: AutomationTask): Promise<void>;
};

export type BotServiceDeps = {
  registry: BotRegistry;
  sessions: BotSessions;
  readSessions(): Promise<readonly SessionRecord[]>;
  updateSessions(mutate: (records: readonly SessionRecord[]) => readonly SessionRecord[]): Promise<unknown>;
  /** New Session's path: validates the body, writes the record with `bot` and the conversation, starts its runtime. */
  createSession(body: Record<string, unknown>, bot: { id: string; piSessionFile: string }): Promise<SessionRecord>;
  /** Deletes a bot chat's session record and stops its runtime: after a failed create, or with its bot. */
  removeSession(id: string): Promise<void>;
  conversations: BotConversations;
  memory: BotMemory;
  routines: BotRoutines;
  botsDir?: string;
  now?: () => number;
  messagesPerHour?: number;
  readyTimeoutMs?: number;
  report?: (event: { level: "warning" | "error"; action: string; summary: string; detail?: string }) => void;
};

type WaitOptions = {
  timeoutMs: number;
  signal?: AbortSignal;
  /** Resolve `needs-input` once the answering run asks a question, instead of waiting for it to settle. */
  stopAtQuestion: boolean;
  /** An abort withdraws the queued message or stops the answering run (a cancelled routine), instead of only detaching. */
  cancelWork: boolean;
};

type RunWatch = {
  outcome: Promise<BotReply>;
  prompted(): void;
  queueing(): void;
  queued(item: string | undefined): void;
  dispose(): void;
};

export class BotService {
  readonly #registry: BotRegistry;
  readonly #sessions: BotSessions;
  readonly #deps: BotServiceDeps;
  readonly #botsDir: string;
  readonly #now: () => number;
  readonly #messagesPerHour: number;
  readonly #readyTimeoutMs: number;
  /** `message_bot` send times per bot over the last hour; memory only. */
  #sent = new Map<string, number[]>();
  /** Newest message per bot, from its live transcript or one store read while no session holds it. */
  #lastMessages = new Map<string, { reference: string | undefined; message: BotLastMessage | undefined }>();

  constructor(deps: BotServiceDeps) {
    this.#deps = deps;
    this.#registry = deps.registry;
    this.#sessions = deps.sessions;
    this.#botsDir = deps.botsDir ?? BOTS_DIR;
    this.#now = deps.now ?? Date.now;
    this.#messagesPerHour = deps.messagesPerHour ?? MESSAGES_PER_HOUR;
    this.#readyTimeoutMs = deps.readyTimeoutMs ?? READY_TIMEOUT_MS;
  }

  /** Active bots, or with `archived` only archived ones (`"all"`: both), sorted by name. */
  async list(options: { archived?: boolean | "all" } = {}): Promise<BotView[]> {
    const bots = (await this.#registry.list()).filter((bot) => options.archived === "all" || Boolean(bot.archived) === Boolean(options.archived));
    if (!bots.length) return [];
    const [records, tasks] = await Promise.all([this.#deps.readSessions(), this.#routineTasks()]);
    const byId = new Map(records.map((record) => [record.id, record]));
    return Promise.all(sortBots(bots).map((bot) => this.#view(bot, byId.get(bot.sessionId), tasks)));
  }

  async resolve(target: string): Promise<BotRecord> {
    return findBot(await this.#registry.list(), target);
  }

  async get(target: string): Promise<BotView> {
    return this.#viewOf(await this.resolve(target));
  }

  /** What a session view shows of the bot whose chat it is, from the last registry read. */
  identity(botId: string): { id: string; handle: string; name: string } | undefined {
    const bot = this.#registry.cached.find((candidate) => candidate.id === botId);
    return bot ? { id: bot.id, handle: bot.handle, name: bot.name } : undefined;
  }

  /** The bot whose chat this session is. The registry decides: a record whose bot is gone is an ordinary session. */
  async botForSession(sessionId: string): Promise<BotRecord | undefined> {
    return (await this.#registry.list()).find((bot) => bot.sessionId === sessionId);
  }

  /**
   * Creates the bot's conversation (persona, bot document and memory in its
   * creating commit), registers its chat through New Session's path, then the
   * bot. A failed step undoes the earlier ones it can: the directory it made,
   * the session record. An empty conversation left behind is never addressed.
   */
  async create(body: unknown): Promise<BotView> {
    const input = normalizeBotInput(body);
    if (input.handle && (await this.#registry.list()).some((bot) => bot.handle === input.handle)) {
      throw new BotConflictError(`@${input.handle} is already taken.`);
    }
    const id = randomUUID();
    let created: string | undefined;
    let cwd: string;
    if (input.cwd) cwd = await existingDirectory(input.cwd);
    else {
      created = join(this.#botsDir, id);
      await mkdir(created, { recursive: true, mode: 0o700 });
      cwd = created;
    }
    // Only an empty directory this request made goes; a bot's files never do.
    const undo = async () => { if (created) await rmdir(created).catch(() => {}); };
    let reference: string;
    try {
      reference = await this.#deps.conversations.create({
        botId: id, cwd,
        ...(input.model ? { model: input.model } : {}),
        ...(input.thinking ? { thinking: input.thinking } : {}),
        ...(input.instructions ? { instructions: input.instructions } : {}),
        memory: memorySettings(input.name, input.memoryModel, input.memoryThinking),
      });
    } catch (error) {
      await undo();
      throw error;
    }
    let session: SessionRecord;
    try {
      session = await this.#deps.createSession({
        cwd, title: input.name, group: "", tool: "durable",
        ...(input.model ? { model: input.model } : {}),
        ...(input.thinking ? { thinking: input.thinking } : {}),
      }, { id, piSessionFile: reference });
    } catch (error) {
      this.#report("warning", "bot_create_failed", "A bot's conversation was left unused", error);
      await undo();
      throw error;
    }
    const now = new Date(this.#now()).toISOString();
    try {
      const bot = await this.#registry.update((bots) => {
        const handles = new Set(bots.map((bot) => bot.handle));
        if (input.handle && handles.has(input.handle)) throw new BotConflictError(`@${input.handle} is already taken.`);
        const record: BotRecord = {
          id,
          handle: input.handle ?? uniqueHandle(handleFromName(input.name), handles),
          name: input.name,
          ...(input.title ? { title: input.title } : {}),
          ...(input.description ? { description: input.description } : {}),
          ...(input.instructions ? { instructions: input.instructions } : {}),
          cwd,
          ...(input.model ? { model: input.model } : {}),
          ...(input.thinking ? { thinking: input.thinking } : {}),
          ...(input.memoryModel ? { memoryModel: input.memoryModel } : {}),
          ...(input.memoryThinking ? { memoryThinking: input.memoryThinking } : {}),
          ...(input.avatar ? { avatar: input.avatar } : {}),
          ...(input.hidden ? { hidden: true } : {}),
          sessionId: session.id,
          createdAt: now,
          updatedAt: now,
        };
        return { bots: [...bots, record], result: record };
      });
      return await this.#viewOf(bot);
    } catch (error) {
      await this.#deps.removeSession(session.id).catch((cleanup: unknown) => this.#report("error", "bot_create_rollback_failed", "A bot's chat could not be removed after a failed create", cleanup));
      await undo();
      throw error;
    }
  }

  /**
   * Applies a patch: model and thinking through the live chat, instructions and
   * directory on its conversation, name and compactor model on its memory,
   * name and directory on its session record, then the bot. The directory
   * changes only while the chat is idle; its runtime boots again there. A
   * cleared model or thinking level (`""`) puts the chat back on what a new
   * chat gets, and leaves the bot and its chat's record without a choice.
   */
  async update(target: string, body: unknown): Promise<BotView> {
    const patch = normalizeBotPatch(body);
    const bot = await this.resolve(target);
    if (bot.archived) throw new BotConflictError(`@${bot.handle} is archived. Restore it before editing it.`);
    const record = await this.#sessionOf(bot);
    const reference = this.#reference(bot, record);
    if (patch.handle && patch.handle !== bot.handle && (await this.#registry.list()).some((other) => other.handle === patch.handle)) {
      throw new BotConflictError(`@${patch.handle} is already taken.`);
    }
    const cwd = patch.cwd === undefined ? undefined : await existingDirectory(patch.cwd);
    const moving = cwd !== undefined && cwd !== bot.cwd;
    if (moving && this.#sessions.status(bot.sessionId) !== "idle") {
      throw new BotConflictError(`@${bot.handle} is busy. Stop it or let it finish before moving its working directory.`);
    }
    if (patch.memoryModel) await this.#deps.conversations.checkModel(patch.memoryModel);
    if (patch.model !== undefined || patch.thinking !== undefined) {
      await this.#open(record);
      // Cleared: what a new chat in the bot's directory would start on now.
      const where = cwd ?? bot.cwd;
      if (patch.model !== undefined) {
        const model = patch.model || await this.#deps.conversations.defaultModel(where);
        if (!model) throw new BotConflictError("This gateway has no model a chat could start on.");
        const slash = model.indexOf("/");
        await this.#sessions.setModel(bot.sessionId, model.slice(0, slash), model.slice(slash + 1));
      }
      if (patch.thinking !== undefined) {
        const current = this.#sessions.snapshot(bot.sessionId).model;
        const level = patch.thinking || await this.#deps.conversations.defaultThinking(where, current && `${current.provider}/${current.id}`);
        await this.#sessions.setThinking(bot.sessionId, level);
      }
    }
    if (patch.instructions !== undefined || moving) {
      await this.#deps.conversations.configure(reference, {
        ...(patch.instructions !== undefined ? { instructions: patch.instructions || null } : {}),
        ...(moving ? { cwd } : {}),
      });
    }
    const name = patch.name ?? bot.name;
    if (patch.name !== undefined || patch.memoryModel !== undefined || patch.memoryThinking !== undefined) {
      await this.#deps.memory.configure(reference, memorySettings(
        name,
        patch.memoryModel === undefined ? bot.memoryModel : patch.memoryModel || undefined,
        patch.memoryThinking === undefined ? bot.memoryThinking : patch.memoryThinking || undefined,
      ));
    }
    const cleared = { model: patch.model === "", thinking: patch.thinking === "" };
    if (patch.name !== undefined || moving || cleared.model || cleared.thinking) {
      await this.#deps.updateSessions((records) => records.map((current) => {
        if (current.id !== bot.sessionId) return current;
        const next: SessionRecord = { ...current, ...(patch.name !== undefined ? { title: name } : {}), ...(moving ? { cwd } : {}) };
        // The live chat recorded the default it switched to; like a new bot's chat, the record keeps no choice.
        if (cleared.model) delete next.model;
        if (cleared.thinking) delete next.thinking;
        return next;
      }));
    }
    if (moving && this.#sessions.isLive(bot.sessionId)) {
      const moved = (await this.#deps.readSessions()).find((current) => current.id === bot.sessionId);
      if (moved) await this.#sessions.restart(moved);
    }
    const now = new Date(this.#now()).toISOString();
    const updated = await this.#registry.update((bots) => {
      const current = bots.find((candidate) => candidate.id === bot.id);
      if (!current) throw new BotNotFoundError(`No bot named ${target}.`);
      if (patch.handle && bots.some((other) => other.id !== bot.id && other.handle === patch.handle)) {
        throw new BotConflictError(`@${patch.handle} is already taken.`);
      }
      const next = patched(current, patch, cwd, now);
      return { bots: bots.map((candidate) => candidate.id === bot.id ? next : candidate), result: next };
    });
    return this.#viewOf(updated);
  }

  /**
   * Archives without deleting anything: marks the bot, disables its routines,
   * withdraws messages still queued for it, stops a running turn and archives
   * its chat's session record. Every step is idempotent, so archiving again
   * finishes what an interrupted attempt left.
   */
  async archive(target: string): Promise<BotView> {
    const found = await this.resolve(target);
    const now = new Date(this.#now()).toISOString();
    const bot = await this.#registry.update((bots) => {
      const current = bots.find((candidate) => candidate.id === found.id);
      if (!current) throw new BotNotFoundError(`No bot named ${target}.`);
      const next: BotRecord = current.archived ? current : { ...current, archived: true, updatedAt: now };
      return { bots: bots.map((candidate) => candidate.id === found.id ? next : candidate), result: next };
    });
    for (const task of (await this.#deps.routines.tasks()).filter((task) => task.sessionId === bot.sessionId && task.enabled)) {
      await this.#deps.routines.disable(task);
    }
    // Messages still waiting in HUI's queue would start a new turn once the current one stops.
    for (const item of this.#sessions.snapshot(bot.sessionId).queue.items ?? []) {
      try { this.#sessions.removeFollowUp(bot.sessionId, item.id); } catch { /* sent meanwhile */ }
    }
    const status = this.#sessions.status(bot.sessionId);
    if (status === "running" || status === "waiting") {
      await this.#sessions.abort(bot.sessionId).catch((error: unknown) => this.#report("warning", "bot_archive_stop_failed", "An archived bot's turn could not be stopped", error));
    }
    await this.#deps.updateSessions((records) => records.map((record) => record.id === bot.sessionId && !record.archived ? { ...record, archived: true } : record));
    return this.#viewOf(bot);
  }

  /** Unarchives the bot and its chat. Its routines stay disabled until the operator turns them on. */
  async restore(target: string): Promise<BotView> {
    const found = await this.resolve(target);
    const now = new Date(this.#now()).toISOString();
    const bot = await this.#registry.update((bots) => {
      const current = bots.find((candidate) => candidate.id === found.id);
      if (!current) throw new BotNotFoundError(`No bot named ${target}.`);
      const { archived: _archived, ...rest } = current;
      const next: BotRecord = current.archived ? { ...rest, updatedAt: now } : current;
      return { bots: bots.map((candidate) => candidate.id === found.id ? next : candidate), result: next };
    });
    await this.#deps.updateSessions((records) => records.map((record) => record.id === bot.sessionId && record.archived ? { ...record, archived: undefined } : record));
    return this.#viewOf(bot);
  }

  /**
   * Deletes an archived bot for good. Archiving stays the step that can be
   * undone, so an active bot is refused. Removes every Automation task aimed at
   * its chat, deletes the chat's session record (its runtime stops), then the
   * bot. As with a deleted session, its conversation and memory stay in the
   * Durable store, which HUI no longer opens. A folder HUI made for the bot goes
   * only while empty: the bot's files never do. Each step can run again, so
   * deleting again finishes what an interrupted attempt left.
   */
  async delete(target: string): Promise<void> {
    const bot = await this.resolve(target);
    if (!bot.archived) throw new BotConflictError(`@${bot.handle} is not archived. Archive it before deleting it.`);
    for (const task of (await this.#deps.routines.tasks()).filter((task) => task.sessionId === bot.sessionId)) {
      await this.#deps.routines.remove(task);
    }
    if ((await this.#deps.readSessions()).some((record) => record.id === bot.sessionId)) await this.#deps.removeSession(bot.sessionId);
    if (bot.cwd === join(this.#botsDir, bot.id)) await rmdir(bot.cwd).catch(() => {});
    await this.#registry.update((bots) => ({ bots: bots.filter((candidate) => candidate.id !== bot.id), result: undefined }));
  }

  /**
   * Delivers an operator's message. Without `wait`: `sent` (prompted) or
   * `queued` (a follow-up). With it: the outcome of the run that answers it,
   * `needs-input` as soon as that run asks a question, or `timeout`.
   */
  async send(target: string, message: { text: string; attachments?: readonly PromptAttachment[] }, wait?: { timeoutMs: number; signal?: AbortSignal }): Promise<BotMessageResult> {
    const bot = await this.resolve(target);
    if (bot.archived) throw new BotConflictError(`@${bot.handle} is archived. Restore it before messaging it.`);
    const record = await this.#sessionOf(bot);
    const delivery = await this.#deliver(record, message.text, message.attachments, wait && { ...wait, stopAtQuestion: true, cancelWork: false });
    return delivery.outcome ? await delivery.outcome : { status: delivery.status };
  }

  /** Stops the bot's current turn; an idle bot has nothing to stop. */
  async stop(target: string): Promise<BotView> {
    const bot = await this.resolve(target);
    const status = this.#sessions.status(bot.sessionId);
    if (status === "starting") throw new BotConflictError(`@${bot.handle}'s chat is still starting.`);
    if (status === "running" || status === "waiting") await this.#sessions.abort(bot.sessionId);
    return this.#viewOf(bot);
  }

  async memory(target: string): Promise<{ status: BotMemoryStatus; view: string }> {
    const { bot, reference } = await this.#memoryOf(target);
    // The view first: reading it catches the memory up with the chat, so the status counts the messages it shows.
    const view = await this.#deps.memory.view(reference);
    const status = await this.#deps.memory.status(reference);
    if (!status) throw new BotMemoryUnavailableError(`@${bot.handle}'s chat has no OptChat memory in this gateway.`);
    return { status: memoryStatus(status), view };
  }

  async zoom(target: string, id: number, n: number): Promise<string> {
    if (!Number.isSafeInteger(id) || id < 0 || !Number.isSafeInteger(n) || n < 1) throw new BotInputError("Zoom needs a message id (0 or more) and a span n (1 or more).");
    return this.#deps.memory.zoom((await this.#memoryOf(target)).reference, id, n);
  }

  async memoryHtml(target: string): Promise<string> {
    return this.#deps.memory.html((await this.#memoryOf(target)).reference);
  }

  /**
   * An Automation task aimed at a bot's chat: its prompt arrives as
   * `[routine: <name>] …`, as a follow-up while the bot works, and the run
   * completes when the turn answering it settles. Cancelling (by hand or the
   * task's timeout) withdraws the message or stops that turn.
   */
  async runRoutine(bot: BotRecord, record: SessionRecord, task: Pick<AutomationTask, "name" | "prompt">, signal: AbortSignal): Promise<{ summary?: string }> {
    if (bot.archived) throw new Error(`@${bot.handle} is archived. Restore it to run its routines.`);
    const { outcome } = await this.#deliver(record, `[routine: ${task.name}] ${task.prompt}`, undefined, {
      timeoutMs: Number.POSITIVE_INFINITY, signal, stopAtQuestion: false, cancelWork: true,
    });
    const reply = await outcome!;
    if (reply.status === "failed") throw new Error(reply.error ?? "The routine's turn failed.");
    return reply.reply ? { summary: reply.reply } : {};
  }

  /**
   * `message_bot` from the bot whose chat `callerSessionId` is. Delivered as
   * `[from @sender] …`, one hop more than the message that started the
   * sender's current run; refused beyond `MAX_BOT_HOPS`, to itself, and past
   * the hourly limit. Fire-and-forget: it returns once the message is accepted.
   */
  async messageBot(callerSessionId: string, params: Record<string, unknown>): Promise<{ text: string; to: string; status: "sent" | "queued" }> {
    const bots = await this.#registry.list();
    const sender = bots.find((bot) => bot.sessionId === callerSessionId);
    if (!sender) throw new BotInputError("message_bot is only available in a bot's chat.");
    if (sender.archived) throw new BotConflictError("An archived bot cannot message other bots.");
    const to = typeof params["to"] === "string" ? params["to"].trim() : "";
    const message = typeof params["message"] === "string" ? params["message"].trim() : "";
    if (!to || to.length > 100) throw new BotInputError("to must name a bot: its @handle or its exact name.");
    if (!message || message.length > BOT_LIMITS.message) throw new BotInputError(`message must be 1-${BOT_LIMITS.message} characters.`);
    const target = messageTarget(bots, sender, to);
    if (target.id === sender.id) throw new BotInputError("A bot cannot message itself.");
    if (target.archived) throw new BotConflictError(`@${target.handle} is archived and cannot receive messages.`);
    const records = await this.#deps.readSessions();
    const hop = (hopOf(records.find((record) => record.id === callerSessionId)?.runPrompt) ?? 0) + 1;
    if (hop > MAX_BOT_HOPS) {
      throw new BotConflictError(`This turn answers a message that already crossed ${MAX_BOT_HOPS} bots. HUI stops bot-to-bot chains there so bots cannot loop; answer in your own chat instead.`);
    }
    const now = this.#now();
    const recent = (this.#sent.get(sender.id) ?? []).filter((at) => now - at < HOUR_MS);
    if (recent.length >= this.#messagesPerHour) {
      throw new BotConflictError(`@${sender.handle} already sent ${this.#messagesPerHour} bot messages in the last hour. Wait before sending more.`);
    }
    const record = records.find((candidate) => candidate.id === target.sessionId);
    if (!record) throw new BotConflictError(`@${target.handle}'s chat is missing from HUI's session registry.`);
    const delivery = await this.#deliver(record, `[from @${sender.handle}${hop === 1 ? "" : ` · hop ${hop}`}] ${message}`, undefined);
    this.#sent.set(sender.id, [...recent, now]);
    return { text: `Queued for @${target.handle}.`, to: target.handle, status: delivery.status };
  }

  /** The `bots` system prompt section of one bot's chat. */
  async section(botId: string): Promise<string | undefined> {
    const bots = await this.#registry.list();
    const self = bots.find((bot) => bot.id === botId);
    return self ? botsSection(self, bots.filter((bot) => bot.id !== self.id && !bot.archived)) : undefined;
  }

  async #viewOf(bot: BotRecord): Promise<BotView> {
    const [records, tasks] = await Promise.all([this.#deps.readSessions(), this.#routineTasks()]);
    return this.#view(bot, records.find((record) => record.id === bot.sessionId), tasks);
  }

  async #view(bot: BotRecord, record: SessionRecord | undefined, tasks: readonly AutomationTask[]): Promise<BotView> {
    const reference = record?.piSessionFile;
    const memory = reference ? await this.#deps.memory.status(reference).catch(() => undefined) : undefined;
    const lastMessage = await this.#lastMessage(bot, record);
    return {
      ...bot,
      // The chat's own choice wins: its session controls may switch the model at any time.
      ...(record?.model ? { model: record.model } : {}),
      ...(record?.thinking ? { thinking: record.thinking } : {}),
      status: this.#sessions.status(bot.sessionId),
      ...(lastMessage ? { lastMessage } : {}),
      unread: record?.unread === true,
      ...(memory ? { memory: memoryStatus(memory) } : {}),
      routines: tasks.filter((task) => task.sessionId === bot.sessionId).length,
    };
  }

  /** A broken automation store reports no routines rather than hiding every bot. */
  #routineTasks(): Promise<readonly AutomationTask[]> {
    return this.#deps.routines.tasks().catch(() => []);
  }

  async #lastMessage(bot: BotRecord, record: SessionRecord | undefined): Promise<BotLastMessage | undefined> {
    if (!record) return undefined;
    const reference = record.piSessionFile;
    if (this.#sessions.isLive(record.id)) {
      const live = lastTranscriptMessage(this.#sessions.transcript(record.id), record.updatedAt);
      if (live) {
        this.#lastMessages.set(bot.id, { reference, message: live });
        return live;
      }
    }
    const cached = this.#lastMessages.get(bot.id);
    if (cached && cached.reference === reference) return cached.message;
    if (!reference) return undefined;
    // A chat nobody opened since the gateway started: read the store once, it does not change until opened.
    const stored = await this.#deps.conversations.lastMessage(reference).catch(() => undefined);
    const message = stored ? { role: stored.role, text: stored.text, at: stored.at ?? record.updatedAt } : undefined;
    this.#lastMessages.set(bot.id, { reference, message });
    return message;
  }

  async #sessionOf(bot: BotRecord): Promise<SessionRecord> {
    const record = (await this.#deps.readSessions()).find((candidate) => candidate.id === bot.sessionId);
    if (!record) throw new BotConflictError(`@${bot.handle}'s chat is missing from HUI's session registry.`);
    return record;
  }

  #reference(bot: BotRecord, record: SessionRecord): string {
    if (!record.piSessionFile) throw new BotConflictError(`@${bot.handle}'s chat has no conversation.`);
    return record.piSessionFile;
  }

  async #memoryOf(target: string): Promise<{ bot: BotRecord; reference: string }> {
    const bot = await this.resolve(target);
    return { bot, reference: this.#reference(bot, await this.#sessionOf(bot)) };
  }

  /** Starts the chat's runtime if needed and waits until it takes input. */
  async #open(record: SessionRecord): Promise<void> {
    if (!this.#sessions.ensure(record)) throw new BotNotFoundError("This bot's chat no longer exists.");
    await this.#ready(record.id);
  }

  /** Resolves once the chat is no longer booting: idle takes a prompt, busy a follow-up. */
  #ready(id: string): Promise<void> {
    return new Promise((resolve, reject) => {
      let done = false;
      const finish = (error?: Error) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        watched.unsubscribe();
        if (error) reject(error);
        else resolve();
      };
      const inspect = (status: string) => {
        if (status === "error") finish(new BotConflictError("The bot's chat could not start. Open it to see why."));
        else if (status === "reconnecting" || status === "disconnected") finish(new BotConflictError("The bot's chat is unreachable."));
        else if (status !== "starting") finish();
      };
      const timer = setTimeout(() => finish(new BotConflictError("The bot's chat did not start in time.")), this.#readyTimeoutMs);
      const watched = this.#sessions.watch(id, (message) => {
        if (message.kind === "status") inspect(message.status);
        else if (message.kind === "snapshot") inspect(message.snapshot.status);
        else if (message.kind === "closed") finish(new BotConflictError("The bot's chat exited."));
      });
      inspect(watched.snapshot.status);
    });
  }

  /** A prompt while idle, else a follow-up; with `wait`, also the outcome of the run that answers it. */
  async #deliver(
    record: SessionRecord,
    text: string,
    attachments: readonly PromptAttachment[] | undefined,
    wait?: WaitOptions,
  ): Promise<{ status: "sent" | "queued"; outcome?: Promise<BotReply> }> {
    await this.#open(record);
    if (wait?.signal?.aborted) throw new DOMException("The wait was cancelled.", "AbortError");
    const files = attachments?.length ? attachments : undefined;
    const watch = wait ? this.#watchRun(record.id, wait) : undefined;
    try {
      if (this.#sessions.status(record.id) === "idle") {
        watch?.prompted();
        try {
          await this.#sessions.prompt(record.id, text, files);
          return { status: "sent", ...(watch ? { outcome: watch.outcome } : {}) };
        } catch (error) {
          // Another prompt won the idle moment: queue behind it instead.
          if (!(error instanceof SessionBusyError) || this.#sessions.status(record.id) === "idle") throw error;
          watch?.queueing();
        }
      }
      const item = await this.#sessions.followUp(record.id, text, files);
      watch?.queued(item);
      return { status: "queued", ...(watch ? { outcome: watch.outcome } : {}) };
    } catch (error) {
      watch?.dispose();
      throw error;
    }
  }

  #watchRun(id: string, options: WaitOptions): RunWatch {
    // pending: not submitted yet; queued: our follow-up waits in HUI's queue; running: the run that answers it.
    let phase: "pending" | "queued" | "running" = "pending";
    let item: string | undefined;
    let done = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let resolve!: (reply: BotReply) => void;
    let reject!: (error: unknown) => void;
    const outcome = new Promise<BotReply>((settle, fail) => { resolve = settle; reject = fail; });
    // A disposed watch is never awaited: its outcome must not become an unhandled rejection.
    outcome.catch(() => {});
    const listed = (items: readonly { id: string }[] | undefined) => item !== undefined && (items ?? []).some((entry) => entry.id === item);
    const finish = (reply: BotReply | Error) => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      watched.unsubscribe();
      if (reply instanceof Error) reject(reply);
      else resolve(reply);
    };
    /** A cancelled routine withdraws its queued message, or stops the run answering it. */
    const cancelWork = (at: typeof phase) => {
      if (!options.cancelWork) return;
      if (at === "queued" && item) {
        try { this.#sessions.removeFollowUp(id, item); } catch { /* drained meanwhile */ }
      } else if (at === "running") {
        void this.#sessions.abort(id).catch(() => {});
      }
    };
    const onAbort = () => {
      const was = phase;
      finish(new DOMException("The wait was cancelled.", "AbortError"));
      cancelWork(was);
    };
    const watched = this.#sessions.watch(id, (message) => {
      if (message.kind === "event") {
        const event = message.event;
        if (event.type === "queue_update" && item !== undefined) {
          // Drained into a prompt, or back in the queue after that prompt failed to start.
          if (phase === "queued" && !listed(event.queue.items)) phase = "running";
          else if (phase === "running" && listed(event.queue.items)) phase = "queued";
        } else if (event.type === "settled" && phase === "running") {
          finish(this.#outcome(id));
        }
      } else if (message.kind === "status") {
        if (message.status === "waiting" && phase === "running" && options.stopAtQuestion) finish(this.#needsInput(id));
        else if (message.status === "error") finish({ status: "failed", error: "The bot's chat runtime failed." });
      } else if (message.kind === "closed") {
        finish({ status: "failed", error: "The bot's chat runtime exited." });
      }
    });
    if (Number.isFinite(options.timeoutMs)) timer = setTimeout(() => finish({ status: "timeout" }), options.timeoutMs);
    options.signal?.addEventListener("abort", onAbort, { once: true });
    return {
      outcome,
      prompted: () => { phase = "running"; },
      queueing: () => { phase = "pending"; },
      queued: (queued) => {
        item = queued;
        // HUI may already have drained it into a prompt before followUp returned.
        phase = queued !== undefined && listed(this.#sessions.snapshot(id).queue.items) ? "queued" : "running";
        // Cancelled while followUp was returning: withdraw it now.
        if (done && options.signal?.aborted) cancelWork(phase);
      },
      dispose: () => finish({ status: "failed", error: "The message was not delivered." }),
    };
  }

  /** How the answering run ended, from the transcript it settled with. */
  #outcome(id: string): BotReply {
    const transcript = this.#sessions.transcript(id);
    const last = transcript.at(-1);
    if (last?.kind === "error") return { status: "failed", error: last.message };
    const lastUser = transcript.findLastIndex((entry) => entry.kind === "message" && entry.role === "user");
    const reply = transcript.slice(lastUser + 1).findLast((entry) => entry.kind === "message" && entry.role === "assistant" && entry.text.trim());
    return reply?.kind === "message" ? { status: "answered", reply: reply.text.trim() } : { status: "answered" };
  }

  #needsInput(id: string): BotReply {
    return { status: "needs-input", questions: this.#sessions.snapshot(id).questions.map(botQuestion) };
  }

  #report(level: "warning" | "error", action: string, summary: string, error: unknown): void {
    this.#deps.report?.({ level, action, summary, detail: error instanceof Error ? error.message : String(error) });
  }
}

/** The hop of the bot message a run input starts with (`[from @x]` is hop 1); undefined for any other input. */
export function hopOf(text: string | undefined): number | undefined {
  const match = HOP.exec(text ?? "");
  return match ? Number(match[1] ?? 1) : undefined;
}

/**
 * The `bots` section: who this bot is, the other bots and how to reach them.
 * Byte-stable while the roster is unchanged (ordered by handle, no dates), so
 * it stays inside the prompt cache.
 */
export function botsSection(self: BotRecord, others: readonly BotRecord[]): string {
  const roster = [...others]
    .sort((a, b) => a.handle < b.handle ? -1 : a.handle > b.handle ? 1 : 0)
    .map((bot) => `- @${bot.handle}: ${bot.name}${bot.title ? `, ${bot.title}` : ""}`);
  return [
    `You are @${self.handle} (${self.name}), one of the bots of this HUI. Each bot works in a chat of its own.`,
    roster.length ? `The other bots:\n${roster.join("\n")}` : "There are no other bots yet.",
    `message_bot({ to: "@handle", message }) puts a message in another bot's chat, where it reads "[from @${self.handle}] …" and that bot answers in its own chat; nothing comes back to you by itself. A message from a bot starts with "[from @handle]" or "[from @handle · hop N]": answer it with message_bot only when there is something new to say. HUI stops a chain of bot messages after ${MAX_BOT_HOPS} hops.`,
  ].join("\n\n");
}

/** The newest message a transcript shows, as a one-line preview. */
export function lastTranscriptMessage(transcript: readonly TranscriptEntry[], fallbackAt: string): BotLastMessage | undefined {
  for (let index = transcript.length - 1; index >= 0; index -= 1) {
    const entry = transcript[index]!;
    if (entry.kind !== "message" || !entry.text.trim()) continue;
    const timestamp = entry.metrics?.timestamp;
    return { role: entry.role, text: previewLine(entry.text), at: timestamp === undefined ? fallbackAt : new Date(timestamp).toISOString() };
  }
  return undefined;
}

/** `message_bot`'s target: a handle (`@` optional), else an exact name in any case. Unknown or shared names list the roster. */
function messageTarget(bots: readonly BotRecord[], sender: BotRecord, to: string): BotRecord {
  const handle = to.replace(/^@/u, "").toLowerCase();
  const byHandle = bots.find((bot) => bot.handle === handle);
  if (byHandle) return byHandle;
  const named = bots.filter((bot) => bot.name.toLowerCase() === to.toLowerCase());
  if (named.length === 1) return named[0]!;
  const roster = sortBots(bots.filter((bot) => bot.id !== sender.id && !bot.archived)).map((bot) => `@${bot.handle} (${bot.name})`).join(", ");
  const problem = named.length ? `${named.length} bots are named "${to}"; use a handle` : `No bot is called "${to}"`;
  throw new BotInputError(`${problem}. Bots you can message: ${roster || "none yet"}.`);
}

function sortBots(bots: readonly BotRecord[]): BotRecord[] {
  return [...bots].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) || (a.handle < b.handle ? -1 : 1));
}

function memorySettings(name: string, model: string | undefined, thinking: string | undefined): BotMemorySettings {
  return { name, ...(model ? { model } : {}), ...(thinking ? { thinking } : {}) };
}

/** Only the fields of the shared contract, whatever else the memory reports. */
function memoryStatus(status: BotMemoryStatus): BotMemoryStatus {
  const { usage } = status;
  return {
    messages: status.messages,
    built: status.built,
    pending: status.pending,
    viewBytes: status.viewBytes,
    viewLines: status.viewLines,
    ...(status.waiting ? { waiting: true } : {}),
    ...(status.failing ? { failing: { node: status.failing.node, error: status.failing.error, since: status.failing.since } } : {}),
    usage: { calls: usage.calls, input: usage.input, output: usage.output, cacheRead: usage.cacheRead, cacheWrite: usage.cacheWrite, cost: usage.cost },
  };
}

function botQuestion(question: RuntimeQuestion): BotQuestion {
  return {
    id: question.id,
    method: question.method,
    title: question.title,
    ...(question.method === "confirm" ? { message: question.message } : {}),
    ...(question.method === "select" ? { options: [...question.options] } : {}),
    ...(question.method === "input" && question.placeholder ? { placeholder: question.placeholder } : {}),
    ...(question.method === "editor" && question.prefill ? { prefill: question.prefill } : {}),
  };
}

function patched(bot: BotRecord, patch: BotPatch, cwd: string | undefined, updatedAt: string): BotRecord {
  const next: BotRecord = { ...bot, updatedAt };
  if (patch.name !== undefined) next.name = patch.name;
  if (patch.handle !== undefined) next.handle = patch.handle;
  for (const key of ["title", "description", "instructions", "model", "thinking", "memoryModel", "memoryThinking"] as const) {
    const value = patch[key];
    if (value === undefined) continue;
    if (value) next[key] = value;
    else delete next[key];
  }
  if (cwd !== undefined) next.cwd = cwd;
  if (patch.avatar !== undefined) {
    const avatar = patchedAvatar(bot.avatar, patch.avatar);
    if (avatar) next.avatar = avatar;
    else delete next.avatar;
  }
  if (patch.hidden !== undefined) {
    if (patch.hidden) next.hidden = true;
    else delete next.hidden;
  }
  return next;
}

/** A directory the operator named: `~/` resolved, absolute and existing. */
async function existingDirectory(value: string): Promise<string> {
  const path = resolveWorkingDirectory(value);
  if (!isAbsolute(path)) throw new BotInputError("Working directory must be an absolute path.");
  let info;
  try {
    info = await stat(path);
  } catch {
    throw new BotInputError(`No such directory: ${path}`);
  }
  if (!info.isDirectory()) throw new BotInputError(`Not a directory: ${path}`);
  return path;
}
