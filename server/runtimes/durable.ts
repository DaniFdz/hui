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
  InboxDoc, watchEvents,
  type AgentEvent, type AgentState, type Conversation, type ConversationId, type EntryRecord, type Harness,
} from "@earendil-works/pi-durable";
import { SettingsManager } from "@earendil-works/pi-coding-agent";
import { resolveCommandReference } from "../../src/lib/command-references.ts";
import type { RuntimeInspection } from "../../src/lib/tools-types.ts";
import { durableContext as context, durableHost, type DurableHost } from "./durable-host.ts";
import { filterConfiguredModels } from "./pi-models.ts";
import {
  checkpointsFrom, imageFromMessages, latestRunUsage, promptPayload, restoreAttachmentNames, toolOutput, transcriptFrom,
} from "./pi.ts";
import { RuntimeTimings } from "./transcript-metrics.ts";
import type {
  AgentRuntime, PromptAttachment, RuntimeCheckpoint, RuntimeCommand, RuntimeEvent, RuntimeModel, RuntimeQueue,
  RuntimeRewindOptions, RuntimeSession, RuntimeUsage, StartOptions, TranscriptEntry,
} from "./types.ts";

export const DURABLE_VERSION = "1.0.1";
const REFERENCE_PREFIX = "durable:";

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
  #messages: Message[] = [];
  #entries: EntryRecord[] = [];
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

  /** Attach to the conversation's committed view, then follow every commit. */
  async attach(): Promise<void> {
    const stream = await watchEvents(this.#harness, this.#conversation.id, context);
    this.#agent = stream.snapshot.agent;
    this.#streaming = stream.snapshot.run !== undefined;
    for (const slot of stream.snapshot.tools) this.#toolOutput.set(slot.callId, slot.output ?? "");
    await this.#refresh();
    await this.#refreshQueue();
    stream.start(async (events) => {
      for (const event of events) await this.#onEvent(event);
    });
    this.#stop = async () => { await stream.stop(); };
  }

  #emit(event: RuntimeEvent): void {
    for (const listener of this.#listeners) listener(event);
  }

  async #refresh(): Promise<void> {
    const view = await this.#conversation.context(context);
    this.#entries = [...view.entries];
    // Every visible message, including aborted and failed answers; the model
    // context itself excludes those, but the transcript must still show them.
    this.#messages = view.entries.flatMap((entry) => entry.model ? [...entry.model] : []);
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
        this.#entries.push(event.entry);
        if (event.entry.model) this.#messages.push(...event.entry.model);
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
        this.#emit({ type: "notice", level: "error", message: event.message });
        return;
      case "compaction_start":
        this.#emit({ type: "notice", level: "info", message: "Compacting older context…" });
        return;
      case "compaction_end":
        await this.#refresh();
        return;
      case "run_end":
        await this.#refresh();
        this.#streaming = false;
        this.#emit({ type: "settled", historyRefreshed: true });
        return;
      default:
        return;
    }
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
    const compact = /^\/compact(?:\s+([\s\S]*))?$/u.exec(text.trim());
    if (compact) {
      await this.#conversation.compact(compact[1]?.trim() || undefined, context);
      return;
    }
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

  subscribe(listener: (event: RuntimeEvent) => void): () => void {
    this.#listeners.add(listener);
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

  /** Context use as of the latest answered request, plus the latest run's spend. */
  currentUsage(): RuntimeUsage | undefined {
    const window = this.currentModel()?.contextWindow;
    if (!window) return undefined;
    const last = this.#messages.findLast((message) => message.role === "assistant"
      && (message as { stopReason?: string }).stopReason !== "aborted"
      && (message as { stopReason?: string }).stopReason !== "error") as { usage?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number } } | undefined;
    const usage = last?.usage;
    const tokens = usage ? (usage.input ?? 0) + (usage.output ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0) : null;
    return {
      contextTokens: tokens,
      contextWindow: window,
      percent: tokens === null ? null : Math.min(100, (tokens / window) * 100),
      ...latestRunUsage(this.#messages),
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

  async abort(): Promise<void> {
    await this.#conversation.abort(context);
  }

  /** A fresh context; the earlier entries stay in the store. */
  async clear(): Promise<void> {
    if (this.#streaming) throw new Error("Wait for the current run to finish before clearing the session.");
    await this.#conversation.reset(undefined, context);
    await this.#refresh();
  }

  async reload(): Promise<void> {
    this.#host.prompt.reload(this.#cwd);
    await this.#host.prompt.loader(this.#cwd);
  }

  /** Rewind points in PI's shape: each visible entry, linked to the one before. */
  async checkpoints(): Promise<readonly RuntimeCheckpoint[]> {
    await this.#refresh();
    const entries = this.#entries.filter((entry) => entry.model?.length);
    return checkpointsFrom({
      leafId: entries.length ? String(entries.at(-1)!.id) : undefined,
      entries: entries.flatMap((entry, index) => entry.model!.map((message) => ({
        type: "message", id: String(entry.id), parentId: index > 0 ? String(entries[index - 1]!.id) : null,
        timestamp: new Date((message as { timestamp?: number }).timestamp ?? Date.now()).toISOString(),
        message,
      }))),
    });
  }

  /** Durable history is append-only, so a rewind forks the conversation at
   * that point and continues in the fork; the abandoned branch is kept. */
  async rewind(entryId: string, options?: RuntimeRewindOptions): Promise<void> {
    if (this.#streaming) throw new Error("Wait for the current run to finish before rewinding.");
    await this.#refresh();
    const entries = this.#entries.filter((entry) => entry.model?.length);
    const index = entries.findIndex((entry) => String(entry.id) === entryId);
    if (index === -1) throw new Error("That rewind point is no longer available.");
    const isUser = entries[index]!.model![0]?.role === "user";
    const at = options?.excludeUserMessage === true && isUser ? entries[index - 1]?.id : entries[index]!.id;
    const next = at
      ? await this.#conversation.fork(at, { ownership: { kind: "ownerless" } }, context)
      : await this.#harness.createConversation({ ownership: { kind: "ownerless" }, agent: {
          ...(this.#agent.model ? { model: this.#agent.model } : {}),
          ...(this.#agent.thinkingLevel ? { thinkingLevel: this.#agent.thinkingLevel } : {}),
          cwd: this.#cwd,
        } }, context);
    await this.#stop?.();
    this.#host.bindCallerLike(this.#conversation.id, next.id);
    this.#conversation = next;
    this.#toolOutput.clear();
    await this.attach();
  }

  attachmentImage(message: number, image: number): { mimeType: string; data: Buffer } | undefined {
    return imageFromMessages(this.#messages, message, image);
  }

  transcript(): TranscriptEntry[] {
    return transcriptFrom(this.#messages, this.#timings);
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
