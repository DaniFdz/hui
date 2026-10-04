import type { TranscriptMetrics } from "../../server/runtimes/transcript-metrics.ts";
/**
 * Client half of the session API. HUI owns the registry; the contract is fixed
 * in `docs/api.md`.
 */
import type { ProgressCard } from "./progress-card.ts";
import type { SessionPullRequest } from "../../shared/pull-requests.ts";
import type { SessionJiraIssue } from "../../shared/jira.ts";
import type { TaskSuggestion } from "../../shared/task-suggestions.ts";
import type { Watcher } from "../../shared/watchers.ts";
import { CLIENT_HEADERS, fetchJson } from "./settings-store.ts";
import { trackedFetch } from "./ui-errors.ts";
import type { SessionStage, SessionStageOrigin } from "../../shared/session-stages.ts";
import type { SessionListUpdate } from "../../shared/session-list.ts";

const SESSIONS_URL = "/__hui/sessions";
const CREATE_SESSION_TIMEOUT_MS = 120_000;
/** Mirrors the server's close code for a session that no longer exists. */
const SESSION_STREAM_GONE = 4404;
const SESSION_STATUSES_URL = `${SESSIONS_URL}/events`;

export type SessionStatus = "idle" | "running" | "waiting" | "starting" | "error";
export type SessionStatusUpdate = {
  id: string;
  status: SessionStatus;
  unread?: boolean;
  creating?: WorktreeProgress;
  creationError?: string;
  /** Present when the gateway renamed the session, e.g. its generated title. */
  title?: string;
};

export type WorktreeProgress = {
  /** `naming` precedes Git work while the utility model picks the branch. */
  phase: "naming" | "preparing" | "checkout" | "filtering" | "finalizing";
  percent?: number;
  completed?: number;
  total?: number;
};

export type GitCheckoutInfo = {
  available: boolean;
  headBranch: string;
  defaultBranch: string;
  branches: readonly string[];
  branchesUnavailable?: boolean;
};

export type SessionView = {
  progress?: ProgressCard;
  /** Pull requests the session created, oldest first; GitHub facts may be absent. */
  pullRequests?: readonly SessionPullRequest[];
  /** Jira work items linked to the session, oldest first; Jira facts may be absent. */
  jiraIssues?: readonly SessionJiraIssue[];
  id: string;
  title: string;
  /** Already flattened by the backend: `pr-signal-notifications - v1`. */
  group: string;
  cwd: string;
  /** `cwd` with home shortened to `~/`; absent from older gateways. */
  displayCwd?: string;
  tool: string;
  status: SessionStatus;
  /** Git worktree progress while the gateway still creates this session. */
  creating?: WorktreeProgress;
  /** Why the gateway could not create this worktree session, and its unsent prompt. */
  creationError?: string;
  initialPrompt?: string;
  /** Ephemeral process telemetry; absent for cold or failed sessions. */
  runtime?: {
    active: true;
    memoryBytes?: number;
    bootDurationMs?: number;
  };
  /** The previous runtime disappeared before its active run settled. */
  interrupted?: boolean;
  /** `provider/id` the session is running on, when the tool reports one. */
  model?: string;
  /** Runtime reasoning level persisted with the HUI session. */
  thinking?: string;
  /** Sorts to the top of its group. */
  pinned?: boolean;
  /** Organizer metadata owned by HUI, matching OpenClaw's session menu. */
  archived?: boolean;
  unread?: boolean;
  icon?: string;
  /** Parent session for a child created through `sessions_spawn`. */
  parentId?: string;
  subagent?: {
    taskId: string;
    task: string;
    label?: string;
    status: SubagentStatus;
    startedAt: string;
    updatedAt: string;
    endedAt?: string;
    summary?: string;
    error?: string;
  };
  /** Kanban development stage; absent (or `backlog` from older gateways)
   * means Investigation. */
  stage?: SessionStage;
  stageOrigin?: SessionStageOrigin;
  createdAt: string;
  updatedAt: string;
};

export type SubagentStatus =
  | "starting"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "timed_out"
  | "interrupted";

export type SubagentTaskView = {
  taskId: string;
  sessionId: string;
  parentSessionId: string;
  title: string;
  task: string;
  status: SubagentStatus;
  startedAt: string;
  updatedAt: string;
  endedAt?: string;
  summary?: string;
  error?: string;
};

export type SessionGroup = {
  label: string;
  /** HUI-owned defaults used when the group starts a new session. */
  cwd?: string;
  workspaceMode?: "branch" | "worktree";
  baseRef?: string;
  sessions: SessionView[];
};

/** Labels are presentation, not registry identifiers. Preserve stored spelling. */
export function sessionGroupLabel(label: string): string {
  return !label || label === "ungrouped" ? "OTHER" : label.toLocaleUpperCase();
}

/** The API stores ungrouped sessions as an empty string while group projections
 * expose the stable `ungrouped` key used by the sidebar. */
export function storedSessionGroup(label: string): string {
  return !label || label === "ungrouped" ? "" : label;
}

/** `url` is an opaque gateway route (or a local data URL while pending) for images. */
export type TranscriptAttachment = { name: string; kind?: "image" | "file"; mimeType?: string; url?: string };

export type TranscriptEntry = { metrics?: TranscriptMetrics } & (
  | {
      kind: "message";
      id?: string;
      /** PI session entry the message came from; the rewind target. */
      entryId?: string;
      role: "user" | "assistant";
      text: string;
      attachments?: readonly (string | TranscriptAttachment)[];
      pending?: boolean;
      failed?: boolean;
    }
  | { kind: "compaction"; id?: string; summary: string; tokensBefore: number }
  | { kind: "thinking"; id?: string; text: string }
  | {
      kind: "tool";
      id: string;
      name: string;
      args?: unknown;
      output?: string;
      details?: unknown;
      failed?: boolean;
      status?: "running" | "succeeded" | "failed";
    }
  | { kind: "error"; id?: string; message: string });

/** A model the runtime offers. Mirrors the server's `RuntimeModel`. */
export type RuntimeModel = { provider: string; id: string; name: string };
/** Runtime-owned slash commands; mirrors the server's RuntimeCommand. */
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

/**
 * An attachment held in the browser before sending. `dataBase64` is the raw
 * payload; the server decides what to do with it per kind.
 */
export type Attachment = {
  kind: "image" | "file";
  name: string;
  mimeType: string;
  dataBase64: string;
};

/** Same shape as the server's `RuntimeEvent`, which is also pi's event shape. */
export type RuntimeEvent =
  | { type: "text"; id?: string; delta: string }
  | { type: "thinking"; id?: string; delta: string }
  | { type: "tool_start"; id: string; name: string; args?: unknown }
  | { type: "tool_update"; id: string; name?: string; output?: string; details?: unknown }
  | { type: "tool_end"; id: string; name: string; output?: string; details?: unknown; failed?: boolean }
  | { type: "queue_update"; queue: QueueSnapshot }
  | { type: "question"; question: RuntimeQuestion }
  | { type: "notice"; message: string; level?: "info" | "warning" | "error" }
  | { type: "thinking_level"; level: string }
  | { type: "turn_start" }
  | { type: "turn_end" }
  | { type: "compaction_start"; reason: RuntimeCompaction["reason"]; blocking?: false; background?: true }
  | { type: "compaction_end"; reason: RuntimeCompaction["reason"]; outcome: "done" | "failed" | "cancelled"; willRetry: boolean; message?: string }
  | { type: "settled"; historyRefreshed?: boolean }
  | { type: "error"; message: string };

/**
 * A transcript row plus the markers a streamed turn carries. The wire only
 * sends user/assistant messages, so tool calls and errors are client-side
 * additions that keep their place in the conversation.
 */
export type TranscriptItem = { metrics?: TranscriptMetrics } & (
  | { kind: "message"; id: string; entryId?: string; role: "user" | "assistant"; text: string; attachments?: readonly (string | TranscriptAttachment)[]; pending?: boolean; failed?: boolean }
  | { kind: "compaction"; id: string; summary: string; tokensBefore: number }
  | { kind: "thinking"; id: string; text: string }
  | { kind: "tool"; id: string; name: string; args?: unknown; output?: string; details?: unknown; failed?: boolean; status?: "running" | "succeeded" | "failed" }
  | { kind: "error"; id: string; text: string });

export type PromptMode = "prompt" | "steer" | "followUp";
export type RuntimeQuestion = {
  id: string;
  method: "select" | "confirm" | "input" | "editor";
  title?: string;
  message?: string;
  options?: readonly string[];
  placeholder?: string;
  value?: string;
  prefill?: string;
};

export type QueuedMessage = { id: string; text: string; mode: "followUp" };
export type QueueSnapshot = {
  steering: readonly string[];
  followUp: readonly string[];
  items?: readonly QueuedMessage[];
};
export type SessionSnapshot = {
  transcript: TranscriptEntry[];
  status: SessionStatus;
  model?: RuntimeModel;
  usage?: RuntimeUsage;
  thinking?: string;
  queue: QueueSnapshot;
  questions: RuntimeQuestion[];
  subagents: SubagentTaskView[];
  /** Pending `suggest_task` cards; absent when there are none. */
  suggestions?: TaskSuggestion[];
  /** HUI-run background watchers; absent when there are none. */
  watchers?: Watcher[];
  /** A running compaction, or one that ended without a summary. */
  compaction?: RuntimeCompaction;
};

/** Mirrors the server's RuntimeCompaction. */
/** `blocking: false`: the runtime compacts beside the conversation (Durable), so
 * a run carries on and its working indicator stays. `background: true`: the
 * session is idle meanwhile. Without flags the compaction blocks (PI). */
export type RuntimeCompaction = {
  status: "running" | "failed" | "cancelled";
  reason: "manual" | "threshold" | "overflow";
  message?: string;
  blocking?: false;
  background?: true;
};

export function toTranscriptItems(entries: readonly TranscriptEntry[]): TranscriptItem[] {
  return entries.map((entry, index) => ({ ...entry, id: entry.id ?? `history-${index}` })) as TranscriptItem[];
}

/** OpenClaw's Copy → Conversation as Markdown action, adapted to HUI's
 * normalized transcript. Pending rows are included because they are visible. */
export function transcriptAsMarkdown(items: readonly TranscriptItem[]): string {
  return items.map((item) => {
    if (item.kind === "message") return `## ${item.role === "user" ? "User" : "Assistant"}\n\n${item.text}`;
    if (item.kind === "thinking") return `### Thinking\n\n${item.text}`;
    if (item.kind === "error") return `### Error\n\n${item.text}`;
    if (item.kind === "compaction") return `### Context compacted\n\n${item.summary}`;
    const details = item.output || (item.args === undefined ? "" : JSON.stringify(item.args, null, 2));
    return `### Tool: ${item.name}${details ? `\n\n\`\`\`\n${details}\n\`\`\`` : ""}`;
  }).join("\n\n").trim();
}

export function statusCounts(groups: readonly SessionGroup[]): {
  running: number;
  starting: number;
  total: number;
} {
  let running = 0;
  let starting = 0;
  let total = 0;
  for (const group of groups) {
    for (const session of group.sessions) {
      total += 1;
      if (session.status === "running" || session.status === "waiting") {
        running += 1;
      }
      if (session.status === "starting") {
        starting += 1;
      }
    }
  }
  return { running, starting, total };
}

/** `revision` orders this full list against the status stream's changes. */
export type SessionList = { revision: number; groups: SessionGroup[] };

function sessionList(body: Partial<SessionList>): SessionList {
  return { revision: body.revision ?? 0, groups: body.groups ?? [] };
}

export async function loadSessions(): Promise<SessionList> {
  return sessionList(await fetchJson<Partial<SessionList>>(SESSIONS_URL));
}

export async function createSessionGroup(name: string): Promise<SessionList> {
  const body = await fetchJson<Partial<SessionList>>("/__hui/session-groups", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });
  return sessionList(body);
}

export async function updateSessionGroup(
  name: string,
  patch: { name?: string; cwd?: string; workspaceMode?: "branch" | "worktree" | ""; baseRef?: string },
): Promise<SessionList> {
  const body = await fetchJson<Partial<SessionList>>(
    `/__hui/session-groups/${encodeURIComponent(name)}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    },
  );
  return sessionList(body);
}

export async function deleteSessionGroup(name: string): Promise<SessionList> {
  const body = await fetchJson<Partial<SessionList>>(
    `/__hui/session-groups/${encodeURIComponent(name)}`,
    { method: "DELETE" },
  );
  return sessionList(body);
}

/** Persists the complete custom-group order; the server rejects stale lists. */
export async function reorderSessionGroups(order: readonly string[]): Promise<SessionList> {
  const body = await fetchJson<Partial<SessionList>>("/__hui/session-groups", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ order }),
  });
  return sessionList(body);
}

/** Registers a session and starts its runtime. A worktree session returns at
 * once with `creating` set; the gateway finishes it and sends its prompt. */
export async function createSession(input: {
  cwd: string;
  title?: string;
  initialPrompt?: string;
  /** Sent by the gateway with a worktree session's first prompt. */
  initialAttachments?: readonly Attachment[];
  group?: string;
  model?: string;
  thinking?: string;
  worktree?: boolean;
  branchName?: string;
  baseRef?: string;
}): Promise<SessionView> {
  const body = await fetchJson<{ session?: SessionView }>(SESSIONS_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
    // Registration is quick, but a Current checkout switch runs Git first;
    // the 5-second default would abandon a request the gateway still finishes.
    signal: AbortSignal.timeout(CREATE_SESSION_TIMEOUT_MS),
  });
  if (!body.session) {
    throw new Error("The session started but could not be read back.");
  }
  return body.session;
}

export async function loadGitCheckout(cwd: string): Promise<GitCheckoutInfo> {
  const body = await fetchJson<{ checkout?: GitCheckoutInfo }>(
    `/__hui/git-checkout?cwd=${encodeURIComponent(cwd || "~/")}`,
  );
  return body.checkout ?? {
    available: false,
    headBranch: "",
    defaultBranch: "",
    branches: [],
  };
}

/** Ensures a runtime exists and returns what to paint immediately. */
export async function openSession(
  id: string,
): Promise<{ session: SessionView; transcript: TranscriptEntry[]; snapshot?: SessionSnapshot }> {
  const body = await fetchJson<{ session?: SessionView; transcript?: TranscriptEntry[]; snapshot?: SessionSnapshot }>(
    `${SESSIONS_URL}/${encodeURIComponent(id)}/open`,
    { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
  );
  if (!body.session) {
    throw new Error("Could not open that session.");
  }
  return { session: body.session, transcript: body.transcript ?? [], snapshot: body.snapshot };
}

/** Resolves once pi has accepted the prompt, not when the turn finishes. */
/** Renames, regroups, or pins. pi's own session file keeps its name; the
 * registry is HUI's, and pi is left alone. */
export async function renameSession(
  id: string,
  patch: {
    title?: string;
    group?: string;
    pinned?: boolean;
    archived?: boolean;
    unread?: boolean;
    icon?: string;
    /** Operator placement; `null` hands the stage back to the agent. */
    stage?: SessionStage | null;
  },
): Promise<SessionView> {
  const body = await fetchJson<{ session?: SessionView }>(
    `${SESSIONS_URL}/${encodeURIComponent(id)}`,
    { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) },
  );
  if (!body.session) {
    throw new Error("The rename did not come back.");
  }
  return body.session;
}

/** Removes the record and stops its runtime. The conversation file under
 * ~/.pi/agent/sessions stays: losing a transcript because you tidied a list
 * would be unforgivable. */
export async function deleteSession(id: string): Promise<void> {
  await fetchJson<{ ok?: boolean }>(`${SESSIONS_URL}/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export async function sendPrompt(
  id: string,
  text: string,
  attachments: readonly Attachment[] = [],
): Promise<void> {
  await fetchJson<{ ok?: boolean }>(`${SESSIONS_URL}/${encodeURIComponent(id)}/prompt`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text, ...(attachments.length ? { attachments } : {}) }),
  });
}

export type SideQuestionResult = { question: string; answer: string; model: string };

export async function askSideQuestion(id: string, question: string): Promise<SideQuestionResult> {
  return fetchJson<SideQuestionResult>(`${SESSIONS_URL}/${encodeURIComponent(id)}/btw`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ question }),
    signal: AbortSignal.timeout(70_000),
  });
}

export async function continueSession(id: string): Promise<void> {
  await fetchJson<{ ok?: boolean }>(`${SESSIONS_URL}/${encodeURIComponent(id)}/continue`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
}

export async function reloadSession(id: string): Promise<void> {
  await fetchJson<{ ok?: boolean }>(`${SESSIONS_URL}/${encodeURIComponent(id)}/reload`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
}

/** Starts the runtime's summary of older context; compaction events report the outcome. */
export async function compactSession(id: string, instructions?: string): Promise<void> {
  await fetchJson<{ ok?: boolean }>(`${SESSIONS_URL}/${encodeURIComponent(id)}/compact`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(instructions ? { instructions } : {}),
  });
}

/** Cancels a manual compaction the runtime runs beside the conversation; its end arrives as an event. */
export async function cancelCompaction(id: string): Promise<void> {
  await fetchJson<{ ok?: boolean }>(`${SESSIONS_URL}/${encodeURIComponent(id)}/compact`, { method: "DELETE" });
}

export async function clearSession(id: string): Promise<SessionSnapshot> {
  const body = await fetchJson<{ snapshot?: SessionSnapshot }>(
    `${SESSIONS_URL}/${encodeURIComponent(id)}/clear`,
    { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
  );
  if (!body.snapshot) throw new Error("The cleared session state did not come back.");
  return body.snapshot;
}

async function sendQueued(
  id: string,
  action: "steer" | "follow-up",
  text: string,
  attachments: readonly Attachment[] = [],
): Promise<void> {
  await fetchJson<{ ok?: boolean }>(
    `${SESSIONS_URL}/${encodeURIComponent(id)}/${action}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, ...(attachments.length ? { attachments } : {}) }),
    },
  );
}

export const steerSession = (id: string, text: string, attachments?: readonly Attachment[]) =>
  sendQueued(id, "steer", text, attachments);

export const followUpSession = (id: string, text: string, attachments?: readonly Attachment[]) =>
  sendQueued(id, "follow-up", text, attachments);

export async function mutateQueuedMessage(
  id: string,
  mutation:
    | { operation: "edit"; itemId: string; text: string }
    | { operation: "remove"; itemId: string }
    | { operation: "move"; itemId: string; toIndex: number }
    | { operation: "steer"; itemId: string },
): Promise<void> {
  await fetchJson<{ ok?: boolean }>(`${SESSIONS_URL}/${encodeURIComponent(id)}/queue`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(mutation),
  });
}

export async function setSessionThinking(id: string, level: string): Promise<string> {
  const body = await fetchJson<{ level?: string }>(`${SESSIONS_URL}/${encodeURIComponent(id)}/thinking`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ level }),
  });
  return body.level ?? level;
}

export async function answerQuestion(
  id: string,
  questionId: string,
  answer: { value?: string; confirmed?: boolean; cancelled?: boolean },
): Promise<void> {
  await fetchJson<{ ok?: boolean }>(`${SESSIONS_URL}/${encodeURIComponent(id)}/question`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: questionId, ...answer }),
  });
}

/** Models this session can switch to. Empty when the tool cannot list any. */
export async function loadModels(id: string): Promise<RuntimeModel[]> {
  const body = await fetchJson<{ models?: RuntimeModel[] }>(
    `${SESSIONS_URL}/${encodeURIComponent(id)}/models`,
  );
  return body.models ?? [];
}

export async function loadCommands(id: string): Promise<RuntimeCommand[]> {
  const body = await fetchJson<{ commands: RuntimeCommand[] }>(
    `${SESSIONS_URL}/${encodeURIComponent(id)}/commands`,
  );
  return body.commands;
}

/** Switches model for the rest of the session, and remembers the choice. */
export async function setSessionModel(
  id: string,
  provider: string,
  modelId: string,
): Promise<RuntimeModel | undefined> {
  const body = await fetchJson<{ model?: RuntimeModel | null }>(
    `${SESSIONS_URL}/${encodeURIComponent(id)}/model`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider, modelId }),
    },
  );
  return body.model ?? undefined;
}

/** Stops the turn in flight without ending the session. */
export async function abortSession(id: string): Promise<void> {
  await fetchJson<{ ok?: boolean }>(`${SESSIONS_URL}/${encodeURIComponent(id)}/abort`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
}

/** A PI entry id, or a user message not yet shown with one, counted from the end. */
export type RewindTarget = string | { userFromEnd: number };

export async function rewindSession(id: string, target: RewindTarget, excludeUserMessage = false): Promise<void> {
  await fetchJson<{ ok?: boolean }>(`${SESSIONS_URL}/${encodeURIComponent(id)}/rewind`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...(typeof target === "string" ? { entryId: target } : target), excludeUserMessage }),
  });
}

export async function resumeSession(id: string): Promise<void> {
  await fetchJson<{ ok?: boolean }>(`${SESSIONS_URL}/${encodeURIComponent(id)}/resume`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
}

/** How the client's stream to a session is doing. `stopped` is terminal. */
export type SessionConnection = "live" | "reconnecting" | "stopped";

export type SessionStreamHandlers = {
  onSnapshot: (snapshot: SessionSnapshot) => void;
  onTranscript: (entries: TranscriptEntry[]) => void;
  onEvent: (event: RuntimeEvent) => void;
  onStatus: (status: SessionStatus) => void;
  /** The model changed, either at boot or because the user switched it. */
  onModel: (model: RuntimeModel) => void;
  onThinking: (level: string) => void;
  /**
   * Called on every connect and reconnect. `live` means the stream delivered,
   * `reconnecting` means a retry is scheduled, `stopped` means no more retries
   * and `detail` says why.
   */
  onConnection: (state: SessionConnection, detail: string) => void;
};

/** The first retry is ~0.5s and the delay doubles to a 4s ceiling, so a gateway
 * restart recovers in a few seconds without hammering the port while it is
 * down. Equal jitter keeps a screenful of tabs off the same retry schedule. */
const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 4_000;

/** Exported so the backoff curve can be exercised without a live stream. */
export function reconnectDelay(attempt: number, random: () => number = Math.random): number {
  const ceiling = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** (attempt - 1));
  return Math.round(ceiling / 2 + random() * (ceiling / 2));
}

type StreamOutcome =
  | { kind: "ended" }
  | { kind: "refused"; message: string }
  | { kind: "dropped" };

export type SessionStatusesHandlers = {
  /** First frame of every (re)connect. */
  onSnapshot: (statuses: readonly SessionStatusUpdate[]) => void;
  onStatus: (update: SessionStatusUpdate) => void;
  /** The gateway's shared session list: full on connect, then only changes. */
  onSessions?: (update: SessionListUpdate<SessionView>) => void;
};

/** Keeps one lightweight stream open for lifecycle updates from every live
 * session. Detailed token/tool traffic remains scoped to the selected chat. */
export function subscribeSessionStatuses(
  handlers: SessionStatusesHandlers,
  fetcher: typeof fetch = trackedFetch,
): () => void {
  const abort = new AbortController();
  let attempt = 0;

  void (async () => {
    while (!abort.signal.aborted) {
      const outcome = await connectStatusesOnce(handlers, abort.signal, fetcher, () => {
        attempt = 0;
      });
      if (abort.signal.aborted || outcome.kind === "refused") return;
      attempt += 1;
      await sleep(reconnectDelay(attempt), abort.signal);
    }
  })();

  return () => abort.abort();
}

/**
 * Subscribes to a session's event stream, reconnecting on its own when it
 * drops. Returns a function that ends it for good.
 *
 * Each view uses a WebSocket, not a streaming fetch: browsers allow only six
 * HTTP/1.1 connections per origin, so a few split panes would stall every other
 * request. WebSocket cannot set the `x-hui` header, so a guarded POST first
 * mints a one-use ticket for it.
 *
 * Only a network drop is retried. An `event: closed` from the server means the
 * runtime exited and there is nothing left to stream, and a 4xx (or the gone
 * close code) means the server will keep refusing this session; both stop the
 * loop rather than replaying a session that is gone.
 */
export function subscribeSession(id: string, handlers: SessionStreamHandlers): () => void {
  const abort = new AbortController();
  let attempt = 0;

  void (async () => {
    while (!abort.signal.aborted) {
      const outcome = await connectOnce(id, handlers, abort.signal, () => {
        // A connection that delivered a frame is healthy, so the backoff
        // restarts rather than growing across unrelated drops.
        attempt = 0;
      });
      if (abort.signal.aborted) {
        return;
      }
      if (outcome.kind === "ended") {
        handlers.onConnection("stopped", "pi exited — this session is no longer streaming.");
        return;
      }
      if (outcome.kind === "refused") {
        handlers.onConnection("stopped", outcome.message);
        return;
      }
      attempt += 1;
      handlers.onConnection("reconnecting", "");
      await sleep(reconnectDelay(attempt), abort.signal);
    }
  })();

  return () => abort.abort();
}

/** The timer resolves on abort too, so a deselected session is not left waiting. */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
  });
}

async function connectOnce(
  id: string,
  handlers: SessionStreamHandlers,
  signal: AbortSignal,
  onLive: () => void,
): Promise<StreamOutcome> {
  let socket: WebSocket;
  try {
    const response = await trackedFetch(`${SESSIONS_URL}/${encodeURIComponent(id)}/connect`, {
      method: "POST",
      headers: CLIENT_HEADERS,
      cache: "no-store",
      signal,
    });
    if (!response.ok) {
      return response.status >= 500 || response.status === 429
        ? { kind: "dropped" }
        : { kind: "refused", message: `The event stream returned HTTP ${response.status}.` };
    }
    const address = new URL(((await response.json()) as { url: string }).url, location.href);
    address.protocol = address.protocol === "https:" ? "wss:" : "ws:";
    if (signal.aborted) return { kind: "dropped" };
    socket = new WebSocket(address);
  } catch {
    return { kind: "dropped" };
  }
  return new Promise((resolve) => {
    let live = false;
    const finish = (outcome: StreamOutcome) => {
      signal.removeEventListener("abort", abort);
      socket.onmessage = socket.onclose = null;
      socket.close();
      resolve(outcome);
    };
    const abort = () => finish({ kind: "dropped" });
    signal.addEventListener("abort", abort, { once: true });
    socket.onmessage = (message) => {
      if (!live) {
        live = true;
        onLive();
        handlers.onConnection("live", "");
      }
      try {
        const frame = JSON.parse(String(message.data)) as { event: string; data: unknown };
        if (dispatch(frame.event, frame.data, handlers)) finish({ kind: "ended" });
      } catch {
        // A frame that cannot be applied is a drop; the reconnect snapshot resyncs.
        finish({ kind: "dropped" });
      }
    };
    socket.onclose = (event) => finish(event.code === SESSION_STREAM_GONE
      ? { kind: "refused", message: "This session no longer exists." }
      : { kind: "dropped" });
  });
}

export const STATUS_STREAM_STALL_MS = 40_000;

async function connectStatusesOnce(
  handlers: SessionStatusesHandlers,
  signal: AbortSignal,
  fetcher: typeof fetch,
  onLive: () => void,
): Promise<StreamOutcome> {
  let response: Response;
  try {
    response = await fetcher(SESSION_STATUSES_URL, {
      headers: { ...CLIENT_HEADERS, accept: "text/event-stream" },
      cache: "no-store",
      signal,
    });
  } catch {
    return { kind: "dropped" };
  }
  if (!response.ok || !response.body) {
    return response.status >= 500
      ? { kind: "dropped" }
      : { kind: "refused", message: `The session status stream returned HTTP ${response.status}.` };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let live = false;
  // A phone changing networks can leave the socket open but silent; the gateway
  // heartbeats every 15 s, so a longer silence means reconnect and resync.
  let stall: ReturnType<typeof setTimeout> | undefined;
  try {
    for (;;) {
      clearTimeout(stall);
      stall = setTimeout(() => void reader.cancel(), STATUS_STREAM_STALL_MS);
      const { done, value } = await reader.read();
      if (done) break;
      if (!live) {
        live = true;
        onLive();
      }
      buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r\n/g, "\n");
      let at: number;
      while ((at = buffer.indexOf("\n\n")) !== -1) {
        const frame = decodeSseFrame(buffer.slice(0, at));
        buffer = buffer.slice(at + 2);
        if (!frame) continue;
        if (frame.name === "snapshot") {
          handlers.onSnapshot(
            (frame.payload as { statuses?: SessionStatusUpdate[] }).statuses ?? [],
          );
        } else if (frame.name === "status") {
          handlers.onStatus(frame.payload as SessionStatusUpdate);
        } else if (frame.name === "sessions") {
          handlers.onSessions?.(frame.payload as SessionListUpdate<SessionView>);
        }
      }
    }
  } catch {
    return { kind: "dropped" };
  } finally {
    clearTimeout(stall);
  }
  return { kind: "dropped" };
}

/** Returns true for the server's terminal `closed` event. */
function dispatch(name: string, payload: unknown, handlers: SessionStreamHandlers): boolean {
  switch (name) {
    case "snapshot":
      handlers.onSnapshot(payload as SessionSnapshot);
      break;
    case "transcript":
      handlers.onTranscript(payload as TranscriptEntry[]);
      break;
    case "event":
      handlers.onEvent(payload as RuntimeEvent);
      break;
    case "status":
      handlers.onStatus((payload as { status: SessionStatus }).status);
      break;
    case "model":
      handlers.onModel(payload as RuntimeModel);
      break;
    case "thinking_level":
      handlers.onThinking((payload as { level: string }).level);
      break;
    case "closed":
      return true;
    default:
      break;
  }
  return false;
}

function decodeSseFrame(chunk: string): { name: string; payload: unknown } | undefined {
  let name = "message";
  const data: string[] = [];
  for (const line of chunk.split("\n")) {
    if (line === "" || line.startsWith(":")) {
      continue;
    }
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) {
      value = value.slice(1);
    }
    if (field === "event") {
      name = value;
    } else if (field === "data") {
      data.push(value);
    }
  }
  if (data.length === 0) {
    return undefined;
  }
  return { name, payload: JSON.parse(data.join("\n")) as unknown };
}
