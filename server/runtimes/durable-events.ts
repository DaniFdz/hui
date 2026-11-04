/**
 * The agent events HUI follows a Durable conversation by.
 *
 * Durable 1.5 renders a conversation as state: `ConversationView` holds a window of the transcript and the built-in
 * documents (`pi.live`, `pi.inbox`, `pi.agent`, `pi.usage`), and a watch hands over each revision as the commit that
 * made it is adopted. Durable used to publish the same information as a stream of agent events, which 1.5 removed; the
 * rest of HUI is written against those events, so this module derives them from each revision: what changed between
 * two views, in the order the coding agent reports it. `durable.ts` turns them into HUI's runtime events and
 * `durable-extensions.ts` hands them to PI's extensions. Nothing here reads storage: a view carries every field the
 * events used to.
 */
import type { Context, WatchCall, WatchEnd } from "@earendil-works/chord";
import type { AssistantMessage, Message, Usage } from "@earendil-works/pi-ai";
import type {
  AgentState, CompactionReason, CompactionStatus, ConversationId, ConversationView, EntryId,
  EntryRecord, Harness, JsonObject, LiveState, NestedToolSlot, SubmissionId, TaskId, ToolSlot,
} from "@earendil-works/pi-durable";
import { isDeepStrictEqual } from "node:util";

/** One change to the in-flight assistant message, relative to that message. */
export type MessageChange =
  | { type: "text_start"; contentIndex: number; block: unknown }
  | { type: "text_delta" | "thinking_delta"; contentIndex: number; delta: string }
  | { type: "block"; contentIndex: number; block: unknown };

/** Which call a tool event is about: the provider's ID for a model-issued call, `<parent>/<key>` for a nested one. */
export type ToolEventCall = {
  toolCallId: string;
  toolName: string;
  parentToolCallId?: string;
};

/** How a nested call ended, as its slot published it and the caller's `NestedCallDoc` keeps it. */
type NestedResult = {
  isError: boolean;
  durationMs?: number;
  diagnostics: readonly { severity: string; message: string }[];
};

type QueuedItem = { id: SubmissionId; mode: string };

/** The conversation as it is at attachment: everything the events below would have described so far. */
export type SnapshotEvent = {
  type: "snapshot";
  entries: readonly EntryRecord[];
  run?: { inputs: readonly SubmissionId[] };
  tools: readonly ToolSlot[];
  nestedTools: readonly NestedToolSlot[];
  compactions: readonly CompactionStatus[];
  agent: AgentState;
};

export type AgentEvent =
  | SnapshotEvent
  | { type: "run_start"; inputs: readonly SubmissionId[] }
  | { type: "run_end"; inputs: readonly SubmissionId[] }
  | { type: "turn_start" }
  | { type: "turn_end" }
  | { type: "message_start"; message: Message }
  | { type: "message_update"; usage: Usage; changes: readonly MessageChange[] }
  | { type: "message_end"; entry: EntryRecord }
  | ({ type: "tool_execution_start"; args: JsonObject } & ToolEventCall)
  | ({
      type: "tool_execution_update";
      /** A front trim and then an append of the retained window, or its replacement. */
      output?: { trimStart?: number; append?: string } | { set: string };
      details?: unknown;
    } & ToolEventCall)
  | ({ type: "tool_execution_end"; entry?: EntryRecord; result?: NestedResult } & ToolEventCall)
  | { type: "inbox_update"; items: readonly QueuedItem[] }
  | { type: "auto_retry_start"; attempt: number; at: number; errorMessage: string }
  | { type: "entry_appended"; entry: EntryRecord }
  | { type: "agent_changed"; agent: AgentState }
  | { type: "compaction_start"; taskId: TaskId; reason: CompactionReason; blocking: boolean }
  | { type: "compaction_end"; taskId: TaskId; reason: CompactionReason };

/** One conversation's events: the state at attachment, then one batch per commit, in that commit's order. */
export interface AgentEventStream {
  readonly snapshot: SnapshotEvent;
  start(listener: (events: readonly AgentEvent[], context: Context) => Promise<void>): void;
  stop(): Promise<WatchEnd>;
  readonly closed: Promise<WatchEnd>;
}

/** What one conversation's stream has shown, to tell what a later view adds. */
type Shown = {
  entries: Set<EntryId>;
  /** Arguments of the calls the entries carry, for a slot that starts running after its answer was written. */
  args: Map<string, JsonObject>;
  tools: Map<string, ToolSlot>;
  nested: Map<string, NestedToolSlot>;
  compactions: Set<string>;
  live: LiveState;
  inbox: unknown;
  agent: unknown;
};

const live = (view: ConversationView): LiveState => (view.docs["pi.live"] ?? {}) as LiveState;
const queued = (view: ConversationView): QueuedItem[] =>
  ((view.docs["pi.inbox"] as { items?: readonly QueuedItem[] } | undefined)?.items ?? []).map((item) => ({ id: item.id, mode: item.mode }));

/** Follow one conversation. The stream is attached when the promise resolves, and the context governs its lifetime. */
export async function watchEvents(harness: Harness, conversationId: ConversationId, context: Context): Promise<AgentEventStream> {
  let view: ConversationView | undefined;
  let attached = false;
  const early: ConversationView[] = [];
  const batches: { events: readonly AgentEvent[]; context: Context }[] = [];
  let listener: ((events: readonly AgentEvent[], context: Context) => Promise<void>) | undefined;
  let state!: Shown;
  let running: Promise<void> = Promise.resolve();
  let done: WatchEnd | undefined;
  let resolveClosed!: (end: WatchEnd) => void;
  const closed = new Promise<WatchEnd>((resolve) => { resolveClosed = resolve; });
  const finish = (end: WatchEnd) => {
    if (done === undefined) { done = end; detach(); resolveClosed(end); }
  };
  let detach = () => {};
  const drain = () => {
    if (!listener) return;
    running = running.then(async () => {
      while (batches.length > 0 && done === undefined) {
        const batch = batches.shift()!;
        await listener!(batch.events, batch.context);
      }
    }).catch((error: unknown) => finish({ kind: "listener_error", error: error instanceof Error ? error : new Error(String(error)) }));
  };
  const show = (events: AgentEvent[], at: Context) => {
    if (events.length === 0 || done !== undefined) return;
    batches.push({ events, context: at });
    drain();
  };
  const observation = await harness.observeConversation(conversationId, {
    advance(call: WatchCall<ConversationView>, at: Context) {
      if (call.kind !== "value") return;
      if (!attached) { early.push(call.value); return; }
      view = call.value;
      show(translate(call.value, state), at);
    },
    end(end) { finish(end); },
  }, context);
  detach = () => observation.detach();
  view = observation.value;
  state = shown(view);
  const snapshot = snapshotOf(view);
  attached = true;
  for (const next of early.splice(0)) {
    view = next;
    show(translate(next, state), context);
  }
  drain();
  return {
    snapshot,
    start(next) { listener = next; drain(); },
    async stop() {
      finish({ kind: "stopped" });
      await running.catch(() => {});
      return done ?? { kind: "stopped" };
    },
    closed,
  };
}

function shown(view: ConversationView): Shown {
  const state: Shown = {
    entries: new Set(view.entries.map((entry) => entry.id)),
    args: new Map(),
    tools: new Map((live(view).tools ?? []).map((slot) => [slot.callId, slot])),
    nested: new Map((live(view).nestedTools ?? []).map((slot) => [slot.callId, slot])),
    compactions: new Set((live(view).compactions ?? []).map((status) => String(status.taskId))),
    live: live(view),
    inbox: view.docs["pi.inbox"],
    agent: view.docs["pi.agent"],
  };
  for (const entry of view.entries) readArgs(entry, state.args);
  return state;
}

function snapshotOf(view: ConversationView): SnapshotEvent {
  const current = live(view);
  return {
    type: "snapshot",
    entries: view.entries,
    ...(current.run === undefined ? {} : { run: { inputs: current.run.inputs } }),
    tools: current.tools ?? [],
    nestedTools: current.nestedTools ?? [],
    compactions: current.compactions ?? [],
    agent: (view.docs["pi.agent"] ?? {}) as AgentState,
  };
}

/** The call arguments an entry carries, for the tool slots its answer will start. */
function readArgs(entry: EntryRecord, args: Map<string, JsonObject>): void {
  for (const message of entry.model ?? []) {
    if (message.role !== "assistant") continue;
    for (const block of message.content) {
      if (block.type === "toolCall") args.set(block.id, block.arguments as JsonObject);
    }
  }
}

/** Every event one revision causes, in the order the coding agent reports its own. */
function translate(after: ConversationView, state: Shown): AgentEvent[] {
  const was = state.live;
  const now = live(after);
  const events: AgentEvent[] = [];
  const added = after.entries.filter((entry) => !state.entries.has(entry.id)).sort((left, right) => left.id - right.id);
  for (const entry of added) readArgs(entry, state.args);

  // A run that starts here is announced before the messages it added, as PI does; one that takes over from a run that
  // ends in the same commit comes after it ended.
  const turnEnded = was.run !== undefined && (now.run === undefined || now.run.taskId !== was.run.taskId);
  const runEnded = was.run !== undefined && (now.run === undefined || now.run.inputs[0] !== was.run.inputs[0]);
  const runStarted = now.run !== undefined && now.run.inputs[0] !== was.run?.inputs[0];
  const announced = runStarted && !turnEnded && !runEnded;
  if (announced) events.push({ type: "run_start", inputs: now.run!.inputs }, { type: "turn_start" });

  const partialWas = was.generation?.message as AssistantMessage | undefined;
  const partial = now.generation?.message as AssistantMessage | undefined;
  if (partial !== undefined && partialWas === undefined) events.push({ type: "message_start", message: partial });
  else if (partial !== undefined && partialWas !== undefined && partial !== partialWas) {
    const changes = messageChanges(partialWas, partial);
    if (changes.length > 0) events.push({ type: "message_update", usage: partial.usage, changes });
  }

  const slots = now.tools ?? [];
  const nested = now.nestedTools ?? [];
  for (const slot of [...slots, ...nested]) {
    const previous = "parentCallId" in slot ? state.nested.get(slot.callId) : state.tools.get(slot.callId);
    if (slot.status !== "running" || previous?.status === "running") continue;
    const args = "parentCallId" in slot ? slot.arguments : state.args.get(slot.callId) ?? {};
    events.push({ type: "tool_execution_start", ...callOf(slot), args });
  }
  if (now.generation?.retry !== undefined && was.generation?.retry === undefined) {
    const { at, error } = now.generation.retry;
    events.push({ type: "auto_retry_start", attempt: now.generation.attempt, at, errorMessage: error });
  }
  for (const slot of slots) {
    const previous = state.tools.get(slot.callId);
    if (slot.status !== "running" || previous?.status !== "running") continue;
    const update = toolUpdate(slot, previous);
    if (update !== undefined) events.push({ type: "tool_execution_update", ...callOf(slot), ...update });
  }
  for (const slot of nested) {
    const previous = state.nested.get(slot.callId);
    if (slot.status !== "running" || previous?.status !== "running") continue;
    const update = toolUpdate(slot, previous);
    if (update !== undefined) events.push({ type: "tool_execution_update", ...callOf(slot), ...update });
  }

  // Calls that end here: a slot that becomes done, one created done (a call not offered), or an unfinished one that its
  // run ended. The ends sit next to their result's entry, as in the coding agent.
  const ended: Extract<AgentEvent, { type: "tool_execution_end" }>[] = [];
  const endItem = (slot: ToolSlot | NestedToolSlot, entry: EntryRecord | undefined) => {
    ended.push("parentCallId" in slot
      ? { type: "tool_execution_end", ...callOf(slot), ...(slot.summary === undefined ? {} : { result: nestedResult(slot) }) }
      : { type: "tool_execution_end", ...callOf(slot), ...(entry === undefined ? {} : { entry }) });
  };
  for (const previous of state.tools.values()) {
    if (previous.status === "done") continue;
    const slot = slots.find((candidate) => candidate.callId === previous.callId);
    if (slot?.status === "done") endItem(slot, after.entries.find((entry) => entry.id === slot.entry));
    else if (slot === undefined) endItem(previous, after.entries.find((entry) => entry.id === previous.entry));
  }
  for (const slot of slots) {
    if (slot.status === "done" && !state.tools.has(slot.callId)) endItem(slot, after.entries.find((entry) => entry.id === slot.entry));
  }
  for (const previous of state.nested.values()) {
    if (previous.status === "done") continue;
    const slot = nested.find((candidate) => candidate.callId === previous.callId);
    if (slot?.status === "done" || slot === undefined) endItem(slot ?? previous, undefined);
  }
  for (const slot of nested) {
    if (slot.status === "done" && !state.nested.has(slot.callId)) endItem(slot, undefined);
  }

  let assistantSeen = false;
  for (const entry of added) {
    state.entries.add(entry.id);
    for (const end of ended) if (end.entry?.id === entry.id) events.push(end);
    const message = entry.model?.[0];
    if (message === undefined) { events.push({ type: "entry_appended", entry }); continue; }
    // An answer that streamed already started with its first partial.
    const streamed = message.role === "assistant" && partialWas !== undefined && !assistantSeen;
    if (message.role === "assistant") assistantSeen = true;
    if (!streamed) events.push({ type: "message_start", message });
    events.push({ type: "message_end", entry });
  }
  for (const end of ended) if (end.entry === undefined) events.push(end);

  for (const status of was.compactions ?? []) {
    if (!(now.compactions ?? []).some((candidate) => candidate.taskId === status.taskId)) {
      events.push({ type: "compaction_end", taskId: status.taskId, reason: status.trigger });
    }
  }
  // A generation's turn ends when it hands over to the next one, or when the run ends: its tool round is part of it.
  if (turnEnded) events.push({ type: "turn_end" });
  if (runEnded) events.push({ type: "run_end", inputs: was.run!.inputs });
  if (!announced) {
    if (runStarted) events.push({ type: "run_start", inputs: now.run!.inputs }, { type: "turn_start" });
    else if (turnEnded && now.run !== undefined) events.push({ type: "turn_start" });
  }
  if (after.docs["pi.inbox"] !== state.inbox) events.push({ type: "inbox_update", items: queued(after) });
  if (after.docs["pi.agent"] !== state.agent) events.push({ type: "agent_changed", agent: (after.docs["pi.agent"] ?? {}) as AgentState });
  for (const status of now.compactions ?? []) {
    if (!state.compactions.has(String(status.taskId))) {
      events.push({ type: "compaction_start", taskId: status.taskId, reason: status.trigger, blocking: status.blocking });
    }
  }

  state.live = now;
  state.tools = new Map(slots.map((slot) => [slot.callId, slot]));
  state.nested = new Map(nested.map((slot) => [slot.callId, slot]));
  state.compactions = new Set((now.compactions ?? []).map((status) => String(status.taskId)));
  state.inbox = after.docs["pi.inbox"];
  state.agent = after.docs["pi.agent"];
  return events;
}

/** Translate the in-flight answer's growth into the changes the events carried. */
function messageChanges(before: AssistantMessage, after: AssistantMessage): MessageChange[] {
  const changes: MessageChange[] = [];
  for (const [contentIndex, block] of after.content.entries()) {
    const was = before.content[contentIndex];
    if (was === undefined) {
      if (block.type === "text") changes.push({ type: "text_start", contentIndex, block });
      continue;
    }
    if (block.type === "text" && was.type === "text") {
      if (block.text.startsWith(was.text)) {
        if (block.text.length > was.text.length) changes.push({ type: "text_delta", contentIndex, delta: block.text.slice(was.text.length) });
      } else changes.push({ type: "block", contentIndex, block });
      continue;
    }
    if (block.type === "thinking" && was.type === "thinking") {
      if (block.thinking.startsWith(was.thinking)) {
        if (block.thinking.length > was.thinking.length) changes.push({ type: "thinking_delta", contentIndex, delta: block.thinking.slice(was.thinking.length) });
      } else changes.push({ type: "block", contentIndex, block });
      continue;
    }
    if (!isDeepStrictEqual(was, block)) changes.push({ type: "block", contentIndex, block });
  }
  return changes;
}

/** The identifying fields of a slot's tool events. */
function callOf(slot: ToolSlot | NestedToolSlot): ToolEventCall {
  return {
    toolCallId: slot.callId,
    toolName: slot.name,
    ...("parentCallId" in slot ? { parentToolCallId: slot.parentCallId } : {}),
  };
}

function nestedResult(slot: NestedToolSlot): NestedResult {
  const summary = slot.summary!;
  return {
    isError: summary.isError,
    ...(summary.durationMs === undefined ? {} : { durationMs: summary.durationMs }),
    diagnostics: summary.error === undefined ? [] : [{ severity: "error", message: summary.error }],
  };
}

/** What a running call's output, details and diagnostics added, as its slot recorded it. */
function toolUpdate(slot: ToolSlot | NestedToolSlot, previous: ToolSlot | NestedToolSlot):
  Omit<Extract<AgentEvent, { type: "tool_execution_update" }>, "type" | keyof ToolEventCall> | undefined {
  const was = previous.output ?? "";
  const now = slot.output ?? "";
  const output = now === was ? undefined : now.startsWith(was) ? { append: now.slice(was.length) } : { set: now };
  const details = isDeepStrictEqual(slot.details, previous.details) ? undefined : { details: slot.details ?? null };
  const update = {
    ...(output === undefined ? {} : { output }),
    ...(details === undefined ? {} : details),
  };
  return Object.keys(update).length === 0 ? undefined : update;
}
