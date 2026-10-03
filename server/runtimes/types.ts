import type { TranscriptMetrics } from "./transcript-metrics.ts";
/**
 * The contract every tool adapter implements.
 *
 * OpenClaw splits this the same way: an *embedded harness* runs the agent loop
 * in-process, a *CLI backend* spawns a process, and a runtime is selected per
 * model rather than per session. HUI only needs the part a UI talks to, so the
 * contract is deliberately tiny — start or resume a session, send a prompt, and
 * stream what comes back.
 *
 * Two adapters exist: `durable` (Pi Durable, the default for new sessions)
 * and `pi` (PI's SDK worker, kept for existing sessions and as a fallback).
 * Another harness can slot in beside them without any of the UI changing.
 */

export type RuntimeQueue = {
  steering: readonly string[];
  followUp: readonly string[];
  /** HUI-owned follow-ups are kept outside the runtime until they are sent, so
   * the operator can still edit, remove, and reorder them. */
  items?: readonly QueuedMessage[];
};

export type QueuedMessage = {
  id: string;
  text: string;
  mode: "followUp";
};

export type RuntimeQuestion =
  | {
      id: string;
      method: "select";
      title: string;
      options: readonly string[];
      timeout?: number;
    }
  | {
      id: string;
      method: "confirm";
      title: string;
      message: string;
      timeout?: number;
    }
  | {
      id: string;
      method: "input";
      title: string;
      placeholder?: string;
      timeout?: number;
    }
  | {
      id: string;
      method: "editor";
      title: string;
      prefill?: string;
      timeout?: number;
    };

export type RuntimeQuestionResponse = { value: string } | { confirmed: boolean };

/** Why PI compacted: `/compact`, its context threshold, or a context overflow it recovers from. */
export type CompactionReason = "manual" | "threshold" | "overflow";

/** A compaction shown outside the transcript: one in progress, or one that
 * ended without writing a summary (a written one is a `compaction` entry). */
export type RuntimeCompaction = { status: "running" | "failed" | "cancelled"; reason: CompactionReason; message?: string };

/** Everything the browser needs to draw a turn, normalised across tools. */
export type RuntimeEvent =
  | { type: "text"; delta: string }
  | { type: "thinking"; delta: string }
  | { type: "tool_start"; id: string; name: string; args?: unknown }
  | { type: "tool_update"; id: string; name: string; output?: string; details?: unknown }
  | { type: "tool_end"; id: string; name: string; output?: string; details?: unknown; failed?: boolean }
  | { type: "queue_update"; queue: RuntimeQueue }
  | { type: "question"; question: RuntimeQuestion }
  | { type: "notice"; message: string; level: "info" | "warning" | "error" }
  | { type: "turn_start" }
  | { type: "turn_end" }
  | { type: "compaction_start"; reason: CompactionReason }
  /** `willRetry`: PI resumes the overflowed turn itself after a summary. */
  | { type: "compaction_end"; reason: CompactionReason; outcome: "done" | "failed" | "cancelled"; willRetry: boolean; message?: string }
  /** The agent stopped entirely. Distinct from `turn_end`: a turn can end while
   * the agent is still working, and the prompt guard follows this one. */
  | { type: "settled"; historyRefreshed?: boolean }
  /** `output` holds the last lines the runtime process wrote to stderr before
   * it failed. It feeds diagnostics only and is never sent to a browser. */
  | { type: "error"; message: string; output?: string };

/**
 * A model the runtime can switch to. `id` is what the tool expects back in
 * `setModel`; `name` is only for display.
 */
export type RuntimeModel = {
  provider: string;
  id: string;
  name: string;
  contextWindow?: number;
  maxTokens?: number;
};

/** A runtime-owned command invoked through an ordinary `/name` prompt. */
export type RuntimeCommand = {
  name: string;
  description: string;
  source: "extension" | "skill" | "prompt";
};

export type RuntimeUsage = {
  contextTokens: number | null;
  contextWindow: number;
  percent: number | null;
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
};

/** A PI entry id, or a user message the browser shows without one yet (the
 * running prompt or one delivered mid-run), counted from the end of the branch. */
export type RuntimeRewindTarget = string | { userFromEnd: number };

export type RuntimeRewindOptions = {
  /** Stop before a selected user entry so its text can be edited and resent. */
  excludeUserMessage?: boolean;
};

/** One attachment travelling with a prompt. Images go to the model natively; a
 * file is stored by the gateway and handed over as a path the agent can read
 * with its own tools. */
export type PromptAttachment =
  | { kind: "image"; mimeType: string; dataBase64: string; name: string }
  | { kind: "file"; path: string; name: string };

export type StartOptions = {
  /** The directory the agent works in. */
  cwd: string;
  /** Runtime resume reference (PI session file path). Absent means a fresh conversation. */
  sessionFile?: string;
  /** Display name, when the tool supports one. */
  title?: string;
  /** `provider/id` to start on, when the tool supports choosing one. */
  model?: string;
  /** Reasoning budget. */
  thinking?: string;
  /** HUI registry id. PI extensions use it to address their private, local
   * coordination bridge without exposing session state to the browser. */
  huiSessionId?: string;
};

export type RuntimeSession = {
  /** Root process owned by this runtime, when the adapter launches one. HUI
   * uses it only for ephemeral resource telemetry; it is never persisted. */
  readonly processId?: number;
  /** A fresh read of the initialized registry and effective prompt. */
  inspect?(): Promise<import("../../src/lib/tools-types.ts").RuntimeInspection>;
  /** The owning runtime's conversation identity. */
  readonly sessionId: string;
  /** Where the conversation is stored, once the tool has decided. */
  readonly sessionFile: string | undefined;
  readonly isStreaming: boolean;
  /** The runtime itself continues runs interrupted by a gateway restart, so
   * HUI must never replay them with a recovery prompt. */
  readonly resumesInterruptedRuns?: boolean;
  prompt(text: string, attachments?: readonly PromptAttachment[]): Promise<void>;
  /** Queue an instruction before the next model call while the agent is busy. */
  steer?(text: string, attachments?: readonly PromptAttachment[]): Promise<void>;
  /** Queue work to begin only after the current agent run has settled. */
  followUp?(text: string, attachments?: readonly PromptAttachment[]): Promise<void>;
  /** Returns an unsubscribe function. */
  subscribe(listener: (event: RuntimeEvent) => void): () => void;
  /*
   * Model and abort are optional: a tool that cannot do them should not have to
   * pretend. The gateway reports what a runtime offers rather than showing a
   * control that silently does nothing.
   */
  /** The model in use, when the tool can report it. */
  currentModel?(): RuntimeModel | undefined;
  /** Context and latest-run usage reported by the runtime. */
  currentUsage?(): RuntimeUsage | undefined;
  /** Models this tool can switch to. */
  listModels?(): Promise<readonly RuntimeModel[]>;
  /** Commands actually loaded in this session's workspace. */
  listCommands?(): Promise<readonly RuntimeCommand[]>;
  /** Switch model for the rest of the session. */
  setModel?(provider: string, id: string): Promise<void>;
  currentThinking?(): string | undefined;
  setThinking?(level: string): Promise<void>;
  pendingQueue?(): RuntimeQueue;
  pendingQuestions?(): readonly RuntimeQuestion[];
  respondQuestion?(id: string, response: RuntimeQuestionResponse): Promise<void>;
  cancelQuestion?(id: string): Promise<void>;
  /** Stop the turn in flight, keeping the session. */
  abort?(): Promise<void>;
  /** Replace the runtime conversation with a fresh one while keeping HUI's
   * session metadata and leaving the previous runtime transcript untouched. */
  clear?(): Promise<void>;
  /** Re-read extensions, skills, prompts and context files in place. */
  reload?(): Promise<void>;
  /** Start a summary of older context; compaction events report progress and outcome. */
  compact?(instructions?: string): Promise<void>;
  /** Move the active leaf without deleting the branch being left. */
  rewind?(target: RuntimeRewindTarget, options?: RuntimeRewindOptions): Promise<void>;
  /** Resume the model from the current non-assistant tail without a user prompt. */
  continueRun?(): Promise<void>;
  /** Fires when the tool's process ends on its own, so a gateway can mark the
   * session failed rather than wait on a session that is already gone. */
  onExit?(listener: () => void): () => void;
  /** Bytes of an image attached to a history message, located by the
   * `source` of a transcript attachment. */
  attachmentImage?(message: number, image: number): { mimeType: string; data: Buffer } | undefined;
  /** Messages already in the conversation, for a first paint. */
  transcript(): TranscriptEntry[];
  dispose(): void;
};

/** An attachment shown on a transcript message. `source` locates image bytes
 * inside the runtime's history and is replaced by an opaque gateway `url`
 * before leaving the server. */
export type TranscriptAttachment = {
  name: string;
  kind: "image" | "file";
  mimeType?: string;
  url?: string;
  source?: { message: number; image: number };
};

export type TranscriptEntry = { metrics?: TranscriptMetrics } & (
  | {
      kind: "message";
      role: "user" | "assistant";
      text: string;
      /** PI session entry the message came from; the rewind target. */
      entryId?: string;
      /** Files or images the user attached to that turn. */
      attachments?: readonly TranscriptAttachment[];
    }
  /** Where PI summarized everything before its kept window. */
  | { kind: "compaction"; summary: string; tokensBefore: number }
  | { kind: "thinking"; text: string }
  | {
      kind: "tool";
      id: string;
      name: string;
      args?: unknown;
      output?: string;
      details?: unknown;
      failed?: boolean;
    }
  | { kind: "error"; message: string });

export type AgentRuntime = {
  /** Runtime adapter ID, such as `pi`. */
  readonly id: string;
  start(options: StartOptions): Promise<RuntimeSession>;
};

/** A runtime that failed to start, with the process output that explains why.
 * `message` is user-facing; `output` feeds diagnostics only. */
export class RuntimeOutputError extends Error {
  readonly output: string;

  constructor(message: string, output: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "RuntimeOutputError";
    this.output = output;
  }
}
