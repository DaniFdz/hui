/**
 * Durable adapter: every HUI session is one Pi Durable conversation in the
 * gateway's harness (see `durable-host.ts`). Durable owns the agent loop,
 * transcript, queue and crash recovery; this adapter translates its committed
 * state and events into HUI's runtime contract. Nothing here retries or
 * replays work after a restart: the harness resumes interrupted runs itself.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { clampThinkingLevel, type Message, type ModelThinkingLevel } from "@earendil-works/pi-ai";
import {
  CompactionEntry, InboxDoc, ResetEntry, SystemEntry, watchEvents,
  type AgentEvent, type AgentState, type CompactionResult, type Conversation, type ConversationId, type Cursor,
  type EntryId, type EntryRecord, type Harness, type TaskId,
} from "@earendil-works/pi-durable";
import { calculateContextTokens, estimateTokens, SettingsManager } from "@earendil-works/pi-coding-agent";
import { resolveCommandReference } from "../../src/lib/command-references.ts";
import type { RuntimeInspection } from "../../src/lib/tools-types.ts";
import { durableContext as context, durableHost, type DurableHost } from "./durable-host.ts";
import { filterConfiguredModels } from "./pi-models.ts";
import {
  imageFromMessages, latestRunUsage, promptPayload, restoreAttachmentNames, toolOutput, transcriptFrom,
} from "./pi.ts";
import { RuntimeTimings } from "./transcript-metrics.ts";
import type {
  AgentRuntime, CompactionReason, PromptAttachment, RuntimeCommand, RuntimeEvent, RuntimeModel, RuntimeQueue,
  RuntimeRewindOptions, RuntimeRewindTarget, RuntimeSession, RuntimeUsage, StartOptions, TranscriptEntry,
} from "./types.ts";

export const DURABLE_VERSION = "1.0.1";
const REFERENCE_PREFIX = "durable:";
/** Entries per store read; a read yields to the event loop between pages. */
const HISTORY_PAGE = 200;
/** How Durable wraps a summary for the model (`harness/compaction.js`). */
const SUMMARY_PREFIX = "The conversation history before this point was compacted into the following summary:\n\n<summary>\n";
const SUMMARY_SUFFIX = "\n</summary>";
/** The kind of Durable's compaction task, as `task_failed` reports it. */
const COMPACTION_TASK = "pi.compaction";
/** Longest a Stop waits for Durable to report that its run and compactions ended. */
const QUIET_TIMEOUT_MS = 30_000;

type SnapshotEvent = Extract<AgentEvent, { type: "snapshot" }>;
/** One stored entry, and the messages the transcript shows for it. */
type Row = { readonly entry: EntryRecord; readonly shown: readonly unknown[] };
type CompactionOutcome = { outcome: "done" | "failed" | "cancelled"; message?: string };

/** A Durable resume reference as HUI's registry stores it. */
export function durableReference(id: ConversationId): string {
  return `${REFERENCE_PREFIX}${String(id)}`;
}

/** Durable IDs are branded integers; a reference carries one in decimal. */
export function durableConversationId(reference: string | undefined): ConversationId | undefined {
  if (!reference?.startsWith(REFERENCE_PREFIX)) return undefined;
  const value = reference.slice(REFERENCE_PREFIX.length);
  const id = Number(value);
  return /^\d+$/u.test(value) && Number.isSafeInteger(id) ? id as unknown as ConversationId : undefined;
}

const internal = async <T>(path: string): Promise<T> =>
  await import(new URL(path, import.meta.resolve("@earendil-works/pi-coding-agent")).href) as T;
const { expandPromptTemplate } = await internal<{ expandPromptTemplate(text: string, templates: unknown[]): string }>("./core/prompt-templates.js");

/** PI's `/skill:name args` expansion, verbatim, for skills PI's loader found. */
function expandSkill(text: string, skills: readonly { name: string; filePath: string; baseDir: string }[]): string {
  if (!text.startsWith("/skill:")) return text;
  const space = text.indexOf(" ");
  const name = space === -1 ? text.slice(7) : text.slice(7, space);
  const args = space === -1 ? "" : text.slice(space + 1).trim();
  const skill = skills.find((candidate) => candidate.name === name);
  if (!skill) return text;
  const body = readFileSync(skill.filePath, "utf8").replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/u, "").trim();
  const block = `<skill name="${skill.name}" location="${skill.filePath}">\nReferences are relative to ${skill.baseDir}.\n\n${body}\n</skill>`;
  return args ? `${block}\n\n${args}` : block;
}

function modelRef(value: string | undefined): { provider: string; modelId: string } | undefined {
  const separator = value?.indexOf("/") ?? -1;
  return value && separator > 0 ? { provider: value.slice(0, separator), modelId: value.slice(separator + 1) } : undefined;
}

function textOf(message: Message | undefined): string {
  if (!message || typeof message !== "object") return "";
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content;
  return Array.isArray(content)
    ? content.flatMap((part) => part && typeof part === "object" && (part as { type?: unknown }).type === "text" ? [String((part as { text?: unknown }).text ?? "")] : []).join("\n")
    : "";
}

/** A compaction entry's summary, without the wrapper the model reads it in. */
function compactionSummary(entry: EntryRecord): string {
  const text = textOf(entry.model?.[0]);
  return text.startsWith(SUMMARY_PREFIX) && text.endsWith(SUMMARY_SUFFIX)
    ? text.slice(SUMMARY_PREFIX.length, text.length - SUMMARY_SUFFIX.length)
    : text;
}

/** Durable leaves aborted and failed answers out of the model context; the transcript still shows them. */
function inContext(message: Message): boolean {
  const stopReason = (message as { stopReason?: string }).stopReason;
  return message.role !== "assistant" || (stopReason !== "aborted" && stopReason !== "error");
}

const role = (message: unknown): unknown => (message as { role?: unknown } | null)?.role;

/** PI's default thinking level for a new conversation without an explicit one. */
function defaultThinking(host: DurableHost, cwd: string): string | undefined {
  return SettingsManager.create(cwd, host.agentDir).getDefaultThinkingLevel();
}

/** The model a new conversation starts on: the requested one, PI's default, or the first available. */
async function initialModel(host: DurableHost, cwd: string, requested: string | undefined) {
  const explicit = modelRef(requested);
  if (explicit) {
    if (!host.models.getModel(explicit.provider, explicit.modelId)) throw new Error(`Unknown model: ${requested}`);
    return explicit;
  }
  const settings = SettingsManager.create(cwd, host.agentDir);
  const provider = settings.getDefaultProvider();
  const id = settings.getDefaultModel();
  if (provider && id && host.models.getModel(provider, id)) return { provider, modelId: id };
  const first = (await host.models.getAvailable())[0];
  return first ? { provider: first.provider, modelId: first.id } : undefined;
}

export class DurableSession implements RuntimeSession {
  readonly #host: DurableHost;
  readonly #harness: Harness;
  readonly #cwd: string;
  #conversation: Conversation;
  #listeners = new Set<(event: RuntimeEvent) => void>();
  #stop: (() => Promise<void>) | undefined;
  /** Fork-aware history, oldest first: what store reads returned, plus entries streamed since. */
  #history: Row[] = [];
  #ids = new Set<EntryId>();
  /** Newest entry a store read returned; the next read starts after it. */
  #readThrough: EntryId | undefined;
  /** What the transcript shows and the context size, rebuilt when the history changes. */
  #shown: unknown[] | undefined;
  #contextSize: number | undefined;
  /** Durable compactions running now, by task. */
  #compactions = new Map<TaskId, { reason: CompactionReason; blocking: boolean }>();
  #quietWaiters = new Set<() => void>();
  #timings = new RuntimeTimings();
  #agent: AgentState = {};
  #queue: RuntimeQueue = { steering: [], followUp: [] };
  #toolOutput = new Map<string, string>();
  #streaming = false;
  #disposed = false;
  readonly resumesInterruptedRuns = true;

  constructor(host: DurableHost, harness: Harness, conversation: Conversation, cwd: string) {
    this.#host = host;
    this.#harness = harness;
    this.#conversation = conversation;
    this.#cwd = cwd;
  }

  get sessionId(): string { return String(this.#conversation.id); }
  get sessionFile(): string { return durableReference(this.#conversation.id); }
  get isStreaming(): boolean { return this.#streaming; }

  /** Attach to the conversation's committed state, read its history, then follow every commit. */
  async attach(): Promise<void> {
    const stream = await watchEvents(this.#harness, this.#conversation.id, context);
    this.#history = [];
    this.#ids.clear();
    this.#readThrough = undefined;
    this.#changed();
    this.#compactions = new Map(stream.snapshot.compactions.map((status) => [status.taskId, { reason: status.reason, blocking: status.blocking }]));
    this.#syncSnapshot(stream.snapshot);
    await this.#read();
    await this.#refreshQueue();
    stream.start(async (events) => {
      for (const event of events) await this.#onEvent(event);
    });
    this.#stop = async () => { await stream.stop(); };
  }

  #emit(event: RuntimeEvent): void {
    for (const listener of this.#listeners) listener(event);
  }

  #syncSnapshot(snapshot: SnapshotEvent): void {
    this.#agent = snapshot.agent;
    this.#streaming = snapshot.run !== undefined;
    for (const slot of snapshot.tools) this.#toolOutput.set(slot.callId, slot.output ?? "");
  }

  /** The history the store holds past `#readThrough` (all of it the first time), read newest first in pages that
   * yield between them, so even a long history never holds the gateway's event loop for long. */
  async #read(): Promise<void> {
    const after = this.#readThrough;
    const fresh: EntryRecord[] = [];
    let cursor: Cursor | undefined;
    do {
      const page = await this.#conversation.entries(after === undefined ? {} : { minEntryId: after }, HISTORY_PAGE, cursor, context);
      fresh.push(...page.items);
      cursor = page.next;
      if (cursor) await new Promise<void>((resolve) => setImmediate(resolve));
    } while (cursor);
    for (const entry of fresh.reverse()) {
      if (after !== undefined && entry.id <= after) continue;
      this.#add(entry);
      if (this.#readThrough === undefined || entry.id > this.#readThrough) this.#readThrough = entry.id;
    }
  }

  /** Adds one entry where its ID places it; streamed entries and later reads overlap. */
  #add(entry: EntryRecord): void {
    if (this.#ids.has(entry.id)) return;
    this.#ids.add(entry.id);
    let index = this.#history.length;
    while (index > 0 && this.#history[index - 1]!.entry.id > entry.id) index--;
    const shown = SystemEntry.is(entry) ? []
      : CompactionEntry.is(entry) ? [{ role: "compaction", summary: compactionSummary(entry), tokensBefore: this.#contextTokens(index) }]
      : (entry.model ?? []).map((message) => ({ ...message, entryId: String(entry.id) }));
    this.#history.splice(index, 0, { entry, shown });
    this.#changed();
  }

  #changed(): void {
    this.#shown = undefined;
    this.#contextSize = undefined;
  }

  /** Where the history since the latest reset (`/clear`) starts. */
  #resetIndex(): number {
    for (let index = this.#history.length - 1; index >= 0; index--) {
      if (ResetEntry.is(this.#history[index]!.entry)) return index;
    }
    return 0;
  }

  /** The transcript's messages: the history since the latest reset, each message with its entry ID, and every
   * compaction as a marker where Durable placed its summary. Compaction never hides history; a reset does. */
  #visible(): unknown[] {
    this.#shown ??= this.#history.slice(this.#resetIndex()).flatMap((row) => row.shown);
    return this.#shown;
  }

  /**
   * Durable's own size estimate (its `estimateContext`) of the context ending before history row `end`: the usage of
   * the newest request answered after the head marker, plus estimates of every message after it; without one,
   * estimates of the whole context, system prompt entries included. The head marker is the newest compaction or
   * reset; its context starts at the entry it heads, and later entries' context edits omit or replace earlier ones
   * (Durable re-baselines its system entries that way).
   */
  #contextTokens(end: number): number {
    let head: EntryRecord | undefined;
    for (let index = end - 1; index >= 0 && !head; index--) {
      if (this.#history[index]!.entry.head !== undefined) head = this.#history[index]!.entry;
    }
    const edits = new Map<EntryId, readonly Message[]>();
    let tokens = 0;
    for (let index = end - 1; index >= 0; index--) {
      const entry = this.#history[index]!.entry;
      if (head?.head !== undefined && entry.id < head.head) break;
      if (entry !== head && entry.head !== undefined) continue;
      // Walking back, the first edit seen for an entry is its latest one.
      for (const edit of entry.edits ?? []) {
        if (!edits.has(edit.target)) edits.set(edit.target, edit.action === "replace" ? edit.messages : []);
      }
      const messages = edits.get(entry.id) ?? entry.model ?? [];
      for (let position = messages.length - 1; position >= 0; position--) {
        const message = messages[position]!;
        if (!inContext(message)) continue;
        const usage = message.role === "assistant" ? message.usage : undefined;
        if (usage && (!head || entry.id > head.id) && calculateContextTokens(usage) > 0) return tokens + calculateContextTokens(usage);
        tokens += estimateTokens(message);
      }
    }
    return tokens;
  }

  async #refreshQueue(): Promise<void> {
    const items = await this.#harness.commit(async (tx) => {
      const inbox = await tx.doc(InboxDoc, this.#conversation.id) as unknown as { items?: readonly { mode: string; content?: unknown }[] };
      return JSON.parse(JSON.stringify(inbox.items ?? [])) as { mode: string; content?: unknown }[];
    }, context);
    const text = (content: unknown) => restoreAttachmentNames(
      typeof content === "string" ? content : textOf({ role: "user", content } as Message),
    ).text;
    this.#queue = {
      steering: items.filter((item) => item.mode === "steer").map((item) => text(item.content)),
      followUp: items.filter((item) => item.mode === "followUp").map((item) => text(item.content)),
    };
  }

  async #onEvent(event: AgentEvent): Promise<void> {
    if (this.#disposed) return;
    switch (event.type) {
      case "snapshot":
        // The stream fell more than 100 commits behind and restarted from a snapshot.
        await this.#resync(event);
        return;
      case "run_start":
        this.#streaming = true;
        return;
      case "turn_start":
      case "turn_end":
        this.#emit({ type: event.type });
        return;
      case "message_update":
        for (const change of event.changes) {
          if (change.type === "text_delta" && change.delta) this.#emit({ type: "text", delta: change.delta });
          else if (change.type === "thinking_delta" && change.delta) this.#emit({ type: "thinking", delta: change.delta });
        }
        return;
      case "message_end":
      case "entry_appended":
        this.#add(event.entry);
        return;
      case "tool_execution_start":
        this.#toolOutput.set(event.toolCallId, "");
        this.#emit({ type: "tool_start", id: event.toolCallId, name: event.toolName, args: event.args });
        return;
      case "tool_execution_update": {
        let output = this.#toolOutput.get(event.toolCallId) ?? "";
        if (event.output && "set" in event.output) output = event.output.set;
        else if (event.output) output = output.slice(event.output.trimStart ?? 0) + (event.output.append ?? "");
        this.#toolOutput.set(event.toolCallId, output);
        this.#emit({
          type: "tool_update", id: event.toolCallId, name: event.toolName, output,
          ...(event.details !== undefined ? { details: event.details } : {}),
        });
        return;
      }
      case "tool_execution_end": {
        if (event.entry) this.#add(event.entry);
        const result = event.entry?.model?.[0] as (Message & { isError?: boolean; details?: unknown }) | undefined;
        this.#toolOutput.delete(event.toolCallId);
        this.#emit({
          type: "tool_end", id: event.toolCallId, name: event.toolName,
          output: toolOutput(result?.content) ?? "",
          ...(result?.details !== undefined ? { details: result.details } : {}),
          failed: result?.isError === true,
        });
        return;
      }
      case "inbox_update":
        await this.#refreshQueue();
        this.#emit({ type: "queue_update", queue: this.pendingQueue() });
        return;
      case "agent_changed":
        this.#agent = event.agent;
        return;
      case "auto_retry_start":
        this.#emit({ type: "notice", level: "warning", message: `Retrying after a provider error (attempt ${event.attempt}): ${event.errorMessage}` });
        return;
      case "task_failed":
        // A failed compaction's divider shows its reason instead.
        if (event.kind !== COMPACTION_TASK) this.#emit({ type: "notice", level: "error", message: event.message });
        return;
      case "compaction_start":
        this.#compactions.set(event.taskId, { reason: event.reason, blocking: event.blocking });
        this.#emit({ type: "compaction_start", reason: event.reason });
        return;
      case "compaction_end":
        await this.#compactionEnded(event.taskId, event.reason);
        return;
      case "run_end":
        await this.#settle();
        return;
      default:
        return;
    }
  }

  /** After a run, or a compaction outside one: read what the store committed, then report the settle. */
  async #settle(): Promise<void> {
    let historyRefreshed = true;
    try {
      await this.#read();
    } catch (error) {
      historyRefreshed = false;
      this.#emit({ type: "error", message: error instanceof Error ? error.message : "Durable history refresh failed." });
    }
    this.#streaming = false;
    this.#emit({ type: "settled", historyRefreshed });
    this.#notifyQuiet();
  }

  async #compactionEnded(taskId: TaskId, reason: CompactionReason): Promise<void> {
    const blocking = this.#compactions.get(taskId)?.blocking === true;
    // Inside a run the compaction settles with it. Outside one (a manual compaction, or background work that
    // outlived its run) the session stays busy until the refreshed history holds the summary, as PI's does.
    // Claimed before the compaction leaves the list, so a waiting Stop never sees a gap.
    const outside = !this.#streaming;
    if (outside) this.#streaming = true;
    this.#compactions.delete(taskId);
    const result = await this.#compactionOutcome(taskId, reason);
    this.#emit({ type: "compaction_end", reason, ...result, willRetry: blocking && result.outcome === "done" });
    if (outside) await this.#settle();
    else this.#notifyQuiet();
  }

  /** The compaction task's receipt: a summary, nothing old enough to summarize, a cancel or a failure. */
  async #compactionOutcome(taskId: TaskId, reason: CompactionReason): Promise<CompactionOutcome> {
    let outcome;
    try {
      outcome = (await this.#harness.waitForTask(taskId as unknown as TaskId<CompactionResult>, context)).state.outcome;
    } catch (error) {
      return { outcome: "failed", message: error instanceof Error ? error.message : "Durable lost track of this compaction." };
    }
    if (outcome.status === "completed") {
      if (outcome.result?.entryId !== undefined || outcome.result?.submissionId !== undefined) return { outcome: "done" };
      // Durable found nothing old enough to summarize; only a requested compaction reports that, in PI's words.
      return reason === "manual" ? { outcome: "failed", message: "Nothing to compact (session too small)" } : { outcome: "done" };
    }
    if (outcome.status === "aborted") return { outcome: "cancelled" };
    if (outcome.status === "failed") return { outcome: "failed", message: outcome.error.message };
    const detail = (outcome as { reason?: unknown }).reason;
    return { outcome: "failed", message: typeof detail === "string" && detail ? detail : "Durable could not finish the compaction." };
  }

  /** A fresh snapshot after the stream fell behind: adopt it, report the compactions that started or ended in the
   * gap, and read the history it skipped. */
  async #resync(snapshot: SnapshotEvent): Promise<void> {
    const running = this.#streaming;
    this.#syncSnapshot(snapshot);
    const live = new Set<TaskId>(snapshot.compactions.map((status) => status.taskId));
    for (const status of snapshot.compactions) {
      if (this.#compactions.has(status.taskId)) continue;
      this.#compactions.set(status.taskId, { reason: status.reason, blocking: status.blocking });
      this.#emit({ type: "compaction_start", reason: status.reason });
    }
    for (const [taskId, { reason }] of [...this.#compactions]) {
      if (!live.has(taskId)) await this.#compactionEnded(taskId, reason);
    }
    if (running && !this.#streaming) await this.#settle();
    else await this.#read().catch(() => {});
  }

  #notifyQuiet(): void {
    if (this.#streaming || this.#compactions.size) return;
    for (const resolve of [...this.#quietWaiters]) resolve();
  }

  /** Resolves once no run or compaction is running in this view, or after `QUIET_TIMEOUT_MS`. */
  #quiet(): Promise<void> {
    if (!this.#streaming && !this.#compactions.size) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => { clearTimeout(timer); this.#quietWaiters.delete(done); resolve(); };
      const timer = setTimeout(done, QUIET_TIMEOUT_MS);
      this.#quietWaiters.add(done);
    });
  }

  async #expand(text: string): Promise<string> {
    const loader = await this.#host.prompt.loader(this.#cwd);
    if (/^\$[^\s]+(?:\s|$)/u.test(text)) text = resolveCommandReference(text, await this.listCommands());
    text = expandSkill(text, loader.getSkills().skills);
    return expandPromptTemplate(text, loader.getPrompts().prompts);
  }

  async #submit(text: string, attachments: readonly PromptAttachment[], whenBusy: "reject" | "steer" | "followUp"): Promise<void> {
    const payload = promptPayload(await this.#expand(text), attachments);
    await this.#conversation.submit({
      type: "input", whenBusy,
      content: [{ type: "text", text: payload.message }, ...(payload.images ?? [])],
    }, context);
  }

  async prompt(text: string, attachments: readonly PromptAttachment[] = []): Promise<void> {
    this.#streaming = true;
    try {
      await this.#submit(text, attachments, "reject");
    } catch (error) {
      this.#streaming = false;
      throw error;
    }
  }

  async steer(text: string, attachments: readonly PromptAttachment[] = []): Promise<void> {
    await this.#submit(text, attachments, "steer");
  }

  async followUp(text: string, attachments: readonly PromptAttachment[] = []): Promise<void> {
    await this.#submit(text, attachments, "followUp");
  }

  /** Starts Durable's compaction task; its start and outcome arrive as compaction events. */
  async compact(instructions?: string): Promise<void> {
    try {
      await this.#conversation.compact(instructions?.trim() || undefined, context);
    } catch (error) {
      this.#emit({ type: "compaction_end", reason: "manual", outcome: "failed", willRetry: false, message: error instanceof Error ? error.message : "Durable could not start the compaction." });
    }
  }

  subscribe(listener: (event: RuntimeEvent) => void): () => void {
    this.#listeners.add(listener);
    // A compaction already running (one Durable resumed after a restart, or started before this view attached) is
    // reported to each new subscriber, so the session shows it busy.
    for (const { reason } of this.#compactions.values()) listener({ type: "compaction_start", reason });
    return () => { this.#listeners.delete(listener); };
  }

  currentModel(): RuntimeModel | undefined {
    const ref = this.#agent.model;
    if (!ref) return undefined;
    const model = this.#host.models.getModel(ref.provider, ref.modelId);
    return {
      provider: ref.provider, id: ref.modelId, name: model?.name ?? ref.modelId,
      ...(model?.contextWindow ? { contextWindow: model.contextWindow } : {}),
      ...(model?.maxTokens ? { maxTokens: model.maxTokens } : {}),
    };
  }

  /** Context use as Durable measures it against its compaction thresholds, plus the latest run's spend. */
  currentUsage(): RuntimeUsage | undefined {
    const window = this.currentModel()?.contextWindow;
    if (!window) return undefined;
    const tokens = this.#history.length ? this.#contextSize ??= this.#contextTokens(this.#history.length) : null;
    return {
      contextTokens: tokens,
      contextWindow: window,
      percent: tokens === null ? null : Math.min(100, (tokens / window) * 100),
      ...latestRunUsage(this.#visible()),
    };
  }

  async listModels(): Promise<readonly RuntimeModel[]> {
    const catalog = (await this.#host.models.getAvailable()).map((model) => ({
      provider: model.provider, id: model.id, name: model.name,
      ...(model.contextWindow ? { contextWindow: model.contextWindow } : {}),
      ...(model.maxTokens ? { maxTokens: model.maxTokens } : {}),
    }));
    return filterConfiguredModels(catalog, this.#host.agentDir);
  }

  async listCommands(): Promise<readonly RuntimeCommand[]> {
    const loader = await this.#host.prompt.loader(this.#cwd);
    return [
      ...loader.getSkills().skills.map((skill) => ({ name: `skill:${skill.name}`, description: skill.description, source: "skill" as const })),
      ...loader.getPrompts().prompts.map((prompt) => ({ name: prompt.name, description: prompt.description ?? "", source: "prompt" as const })),
    ];
  }

  async setModel(provider: string, id: string): Promise<void> {
    const model = this.#host.models.getModel(provider, id);
    if (!model) throw new Error(`Unknown model: ${provider}/${id}`);
    const thinking = clampThinkingLevel(model, (this.#agent.thinkingLevel ?? "off") as ModelThinkingLevel);
    await this.#conversation.configure({ model: { provider, modelId: id }, thinkingLevel: thinking }, context);
    this.#agent = { ...this.#agent, model: { provider, modelId: id }, thinkingLevel: thinking };
  }

  currentThinking(): string | undefined {
    return this.#agent.thinkingLevel;
  }

  async setThinking(level: string): Promise<void> {
    await this.#conversation.configure({ thinkingLevel: level as ModelThinkingLevel }, context);
    this.#agent = { ...this.#agent, thinkingLevel: level as ModelThinkingLevel };
  }

  pendingQueue(): RuntimeQueue {
    return { steering: [...this.#queue.steering], followUp: [...this.#queue.followUp] };
  }

  /** Stops the run and every running compaction, background ones included (a conversation abort leaves those
   * running), and resolves once this view has seen them end: HUI treats a resolved Stop as idle. */
  async abort(): Promise<void> {
    await Promise.all([...this.#compactions.keys()].map((taskId) => this.#harness.abortTask(taskId, context).catch(() => undefined)));
    await this.#conversation.abort(context);
    await this.#quiet();
  }

  /** A fresh context; the earlier entries stay in the store. */
  async clear(): Promise<void> {
    if (this.#streaming || this.#compactions.size) throw new Error("Wait for the current run to finish before clearing the session.");
    await this.#conversation.reset(undefined, context);
    await this.#read();
  }

  async reload(): Promise<void> {
    this.#host.prompt.reload(this.#cwd);
    await this.#host.prompt.loader(this.#cwd);
  }

  /** Durable history is append-only, so a rewind forks the conversation at that point and continues in the fork; the
   * abandoned branch stays stored. A fork before a compaction's marker leaves its summary out, so the model sees the
   * original turns again; inside the summary's kept window the summary stays. */
  async rewind(target: RuntimeRewindTarget, options?: RuntimeRewindOptions): Promise<void> {
    if (this.#streaming || this.#compactions.size) throw new Error("Wait for the current run to finish before rewinding.");
    await this.#read();
    const visible = this.#history.slice(this.#resetIndex());
    const row = typeof target === "string"
      ? visible.find((candidate) => String(candidate.entry.id) === target && !CompactionEntry.is(candidate.entry) && candidate.shown.length > 0)
      // Counted as the browser and PI's worker count: user messages since the latest reset, from the end.
      : visible.filter((candidate) => candidate.shown.some((message) => role(message) === "user")).at(-1 - target.userFromEnd);
    if (!row) throw new Error("That rewind point is no longer available.");
    const index = this.#history.indexOf(row);
    const isUser = role(row.shown[0]) === "user";
    const at = options?.excludeUserMessage === true && isUser ? this.#history[index - 1]?.entry.id : row.entry.id;
    // As PI's worker does (`keepCompaction`): a summary covers only the entries before its kept window. When they all
    // still lead to the fork point, the fork keeps that summary instead of the model rereading what it summarized.
    const leaf = at === undefined ? -1 : this.#history.findIndex((candidate) => candidate.entry.id === at);
    const kept = leaf < 0 ? undefined : this.#history.slice(leaf + 1).findLast(({ entry }) => {
      if (!CompactionEntry.is(entry) || entry.head === undefined) return false;
      const first = this.#history.findIndex((candidate) => candidate.entry.id === entry.head);
      return first >= 0 && leaf >= first - 1;
    })?.entry;
    const next = at
      ? await this.#conversation.fork(at, { ownership: { kind: "ownerless" } }, context)
      : await this.#harness.createConversation({ ownership: { kind: "ownerless" }, agent: {
          ...(this.#agent.model ? { model: this.#agent.model } : {}),
          ...(this.#agent.thinkingLevel ? { thinkingLevel: this.#agent.thinkingLevel } : {}),
          cwd: this.#cwd,
        } }, context);
    if (kept) {
      await next.submit({ type: "write", entry: {
        kind: kept.kind, head: kept.head!, ...(kept.model ? { model: kept.model } : {}), ...(kept.data !== undefined ? { data: kept.data } : {}),
      } }, context);
    }
    await this.#stop?.();
    this.#host.bindCallerLike(this.#conversation.id, next.id);
    this.#conversation = next;
    this.#toolOutput.clear();
    await this.attach();
  }

  attachmentImage(message: number, image: number): { mimeType: string; data: Buffer } | undefined {
    return imageFromMessages(this.#visible(), message, image);
  }

  transcript(): TranscriptEntry[] {
    return transcriptFrom(this.#visible(), this.#timings);
  }

  async inspect(): Promise<RuntimeInspection> {
    const agent = await this.#conversation.agent(context);
    const huiTools = new Set(this.#host.huiToolNames);
    const tools = agent.tools.map((tool) => ({
      name: tool.name, description: tool.description,
      source: huiTools.has(tool.name) ? "HUI" : "Durable",
      active: true, parameters: tool.parameters,
    }));
    const prompt = await this.#host.prompt.render(this.#cwd, agent.tools.map((tool) => tool.name));
    const data = {
      status: "live" as const, backend: "durable", version: DURABLE_VERSION, tools, prompt,
      promptPhase: this.#streaming ? "current-turn" as const : "initialized" as const,
      promptSource: (await this.#host.prompt.loader(this.#cwd)).getSystemPromptSource() ? "SYSTEM.md override" : "hui-v4",
      diagnostics: [] as string[],
    };
    return { ...data, revision: createHash("sha256").update(JSON.stringify(data)).digest("hex").slice(0, 16) };
  }

  /** Detaches this view. The conversation keeps running in the harness. */
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#listeners.clear();
    for (const resolve of [...this.#quietWaiters]) resolve();
    void this.#stop?.().catch(() => {});
  }
}

export async function startDurable(options: StartOptions, host: DurableHost = durableHost()): Promise<DurableSession> {
  const harness = await host.open();
  await host.refreshModels();
  const existing = durableConversationId(options.sessionFile);
  let conversation: Conversation | undefined;
  if (existing) {
    conversation = await harness.conversation(existing, context);
    if (!conversation) throw new Error("That Durable conversation no longer exists in this gateway's store.");
  } else {
    const model = await initialModel(host, options.cwd, options.model);
    const known = model ? host.models.getModel(model.provider, model.modelId) : undefined;
    const requestedThinking = options.thinking ?? defaultThinking(host, options.cwd);
    const thinking = requestedThinking && known ? clampThinkingLevel(known, requestedThinking as ModelThinkingLevel) : undefined;
    conversation = await harness.createConversation({ ownership: { kind: "ownerless" }, agent: {
      cwd: options.cwd,
      ...(model ? { model } : {}),
      ...(thinking ? { thinkingLevel: thinking } : {}),
    } }, context);
  }
  host.bindCaller(conversation.id, options.huiSessionId);
  // Settings → Tools → Browser applies per conversation, at start.
  const browserEnabled = (await host.settings()).browser.enabled !== false;
  await conversation.configure({ tools: browserEnabled ? null : { remove: host.toolsNamed(["browser"]) } }, context);
  await host.prompt.loader(options.cwd);
  const session = new DurableSession(host, harness, conversation, options.cwd);
  await session.attach();
  return session;
}

export const durableRuntime = {
  id: "durable",
  start: (options: StartOptions) => startDurable(options),
} satisfies AgentRuntime;
