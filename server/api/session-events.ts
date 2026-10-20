/** Public session stream payloads: snapshots, transcripts, transmitted runtime events and the open and clear responses. */
import { Type, type Static } from "typebox";
import { CallRecord } from "./calls.ts";
import { QuestionnaireQuestion, SessionConnectResponse, SessionStatus, SessionView, SubagentStatus, TranscriptMetrics } from "./sessions.ts";

export const TranscriptAttachment = Type.Object({
  name: Type.String(), kind: Type.Union([Type.Literal("image"), Type.Literal("file")]), mimeType: Type.Optional(Type.String()), url: Type.Optional(Type.String()),
}, { $id: "TranscriptAttachment" });
export type TranscriptAttachment = Static<typeof TranscriptAttachment>;

const metrics = { metrics: Type.Optional(TranscriptMetrics) };

export const TranscriptEntry = Type.Union([
  Type.Object({
    ...metrics, kind: Type.Literal("message"), role: Type.Union([Type.Literal("user"), Type.Literal("assistant")]), text: Type.String(),
    entryId: Type.Optional(Type.String()), attachments: Type.Optional(Type.Immutable(Type.Array(TranscriptAttachment))),
  }),
  Type.Object({ ...metrics, kind: Type.Literal("call"), ...CallRecord.properties }),
  Type.Object({ ...metrics, kind: Type.Literal("compaction"), summary: Type.String(), tokensBefore: Type.Number() }),
  Type.Object({ ...metrics, kind: Type.Literal("thinking"), text: Type.String() }),
  Type.Object({
    ...metrics, kind: Type.Literal("tool"), id: Type.String(), name: Type.String(), args: Type.Optional(Type.Unknown()),
    output: Type.Optional(Type.String()), details: Type.Optional(Type.Unknown()), failed: Type.Optional(Type.Boolean()),
  }),
  Type.Object({ ...metrics, kind: Type.Literal("error"), message: Type.String() }),
], { $id: "TranscriptEntry" });
export type TranscriptEntry = Static<typeof TranscriptEntry>;

export const RuntimeModel = Type.Object({
  provider: Type.String(), id: Type.String(), name: Type.String(), contextWindow: Type.Optional(Type.Number()), maxTokens: Type.Optional(Type.Number()),
  thinkingLevels: Type.Optional(Type.Immutable(Type.Array(Type.String()))), fast: Type.Optional(Type.Literal(true)),
}, { $id: "RuntimeModel" });
export type RuntimeModel = Static<typeof RuntimeModel>;

export const RuntimeCommand = Type.Object({
  name: Type.String(), description: Type.String(), source: Type.Union([Type.Literal("extension"), Type.Literal("skill"), Type.Literal("prompt")]),
}, { $id: "RuntimeCommand" });
export type RuntimeCommand = Static<typeof RuntimeCommand>;

export const RuntimeUsage = Type.Object({
  contextTokens: Type.Union([Type.Number(), Type.Null()]), contextWindow: Type.Number(), percent: Type.Union([Type.Number(), Type.Null()]),
  inputTokens: Type.Number(), outputTokens: Type.Number(), costUsd: Type.Union([Type.Number(), Type.Null()]),
}, { $id: "RuntimeUsage" });
export type RuntimeUsage = Static<typeof RuntimeUsage>;

export const QueuedMessage = Type.Object({ id: Type.String(), text: Type.String(), mode: Type.Literal("followUp") }, { $id: "QueuedMessage" });
export type QueuedMessage = Static<typeof QueuedMessage>;

export const RuntimeQueue = Type.Object({
  steering: Type.Immutable(Type.Array(Type.String())), followUp: Type.Immutable(Type.Array(Type.String())),
  items: Type.Optional(Type.Immutable(Type.Array(QueuedMessage))),
}, { $id: "RuntimeQueue" });
export type RuntimeQueue = Static<typeof RuntimeQueue>;

const timeout = { timeout: Type.Optional(Type.Number()) };

export const RuntimeQuestion = Type.Union([
  Type.Object({ id: Type.String(), method: Type.Literal("select"), title: Type.String(), message: Type.Optional(Type.String()), options: Type.Immutable(Type.Array(Type.String())), ...timeout }),
  Type.Object({ id: Type.String(), method: Type.Literal("confirm"), title: Type.String(), message: Type.String(), ...timeout }),
  Type.Object({ id: Type.String(), method: Type.Literal("input"), title: Type.String(), placeholder: Type.Optional(Type.String()), ...timeout }),
  Type.Object({ id: Type.String(), method: Type.Literal("editor"), title: Type.String(), prefill: Type.Optional(Type.String()), ...timeout }),
], { $id: "RuntimeQuestion" });
export type RuntimeQuestion = Static<typeof RuntimeQuestion>;

export const SessionQuestion = Type.Union([
  RuntimeQuestion,
  Type.Object({ id: Type.String(), method: Type.Literal("secret"), title: Type.String(), message: Type.String() }),
  Type.Object({ id: Type.String(), method: Type.Literal("questionnaire"), title: Type.String(), questions: Type.Array(QuestionnaireQuestion) }),
], { $id: "SessionQuestion" });
export type SessionQuestion = Static<typeof SessionQuestion>;

export const CompactionReason = Type.Union([Type.Literal("manual"), Type.Literal("threshold"), Type.Literal("overflow")], { $id: "CompactionReason" });
export type CompactionReason = Static<typeof CompactionReason>;

const compactionMode = { blocking: Type.Optional(Type.Literal(false)), background: Type.Optional(Type.Literal(true)) };

export const RuntimeCompaction = Type.Object({
  status: Type.Union([Type.Literal("running"), Type.Literal("failed"), Type.Literal("cancelled")]), reason: CompactionReason,
  message: Type.Optional(Type.String()), ...compactionMode,
}, { $id: "RuntimeCompaction" });
export type RuntimeCompaction = Static<typeof RuntimeCompaction>;

export const SubagentTaskView = Type.Object({
  taskId: Type.String(), sessionId: Type.String(), parentSessionId: Type.String(), title: Type.String(), task: Type.String(),
  status: Type.Union([SubagentStatus, Type.Literal("queued")]), startedAt: Type.String(), updatedAt: Type.String(),
  endedAt: Type.Optional(Type.String()), summary: Type.Optional(Type.String()), error: Type.Optional(Type.String()),
}, { $id: "SubagentTaskView" });
export type SubagentTaskView = Static<typeof SubagentTaskView>;

export const SessionSnapshot = Type.Object({
  transcript: Type.Immutable(Type.Array(TranscriptEntry)),
  status: SessionStatus,
  model: Type.Optional(RuntimeModel),
  usage: Type.Optional(RuntimeUsage),
  thinking: Type.Optional(Type.String()),
  fast: Type.Optional(Type.Boolean()),
  queue: RuntimeQueue,
  questions: Type.Immutable(Type.Array(SessionQuestion)),
  subagents: Type.Immutable(Type.Array(SubagentTaskView)),
  suggestions: Type.Optional(Type.Immutable(Type.Array(Type.Object({
    id: Type.String(), title: Type.String(), problem: Type.String(), fix: Type.String(), cwd: Type.String(),
    worker: Type.Optional(Type.String()), createdAt: Type.String(),
  })))),
  watchers: Type.Optional(Type.Immutable(Type.Array(Type.Object({
    id: Type.String(), purpose: Type.String(), target: Type.String(), outcome: Type.String(), command: Type.String(), logPath: Type.String(),
    state: Type.Union([Type.Literal("running"), Type.Literal("done"), Type.Literal("failed"), Type.Literal("stopped"), Type.Literal("dead")]),
    pid: Type.Union([Type.Number(), Type.Null()]), exitCode: Type.Optional(Type.Number()), startedAt: Type.String(), endedAt: Type.Optional(Type.String()),
    lastLine: Type.String(), keepRunning: Type.Optional(Type.Literal(true)),
  })))),
  compaction: Type.Optional(RuntimeCompaction),
}, { $id: "SessionSnapshot" });
export type SessionSnapshot = Static<typeof SessionSnapshot>;

const toolCall = { id: Type.String(), name: Type.String() };

export const SessionEvent = Type.Union([
  Type.Object({ type: Type.Literal("text"), delta: Type.String() }),
  Type.Object({ type: Type.Literal("thinking"), delta: Type.String() }),
  Type.Object({ type: Type.Literal("tool_start"), ...toolCall, args: Type.Optional(Type.Unknown()) }),
  Type.Object({ type: Type.Literal("tool_update"), ...toolCall, output: Type.Optional(Type.String()), details: Type.Optional(Type.Unknown()) }),
  Type.Object({
    type: Type.Literal("tool_end"), ...toolCall, output: Type.Optional(Type.String()), details: Type.Optional(Type.Unknown()), failed: Type.Optional(Type.Boolean()),
  }),
  Type.Object({ type: Type.Literal("queue_update"), queue: RuntimeQueue }),
  Type.Object({ type: Type.Literal("question"), question: SessionQuestion }),
  Type.Object({ type: Type.Literal("notice"), message: Type.String(), level: Type.Union([Type.Literal("info"), Type.Literal("warning"), Type.Literal("error")]) }),
  Type.Object({ type: Type.Literal("turn_start") }),
  Type.Object({ type: Type.Literal("turn_end") }),
  Type.Object({ type: Type.Literal("compaction_start"), reason: CompactionReason, ...compactionMode }),
  Type.Object({
    type: Type.Literal("compaction_end"), reason: CompactionReason,
    outcome: Type.Union([Type.Literal("done"), Type.Literal("failed"), Type.Literal("cancelled")]), willRetry: Type.Boolean(), message: Type.Optional(Type.String()),
  }),
  Type.Object({ type: Type.Literal("settled"), historyRefreshed: Type.Optional(Type.Boolean()) }),
  Type.Object({ type: Type.Literal("error"), message: Type.String() }),
], { $id: "SessionEvent" });
export type SessionEvent = Static<typeof SessionEvent>;

export const SessionStreamFrame = Type.Union([
  Type.Object({ event: Type.Literal("snapshot"), data: SessionSnapshot }),
  Type.Object({ event: Type.Literal("transcript"), data: Type.Array(TranscriptEntry) }),
  Type.Object({ event: Type.Literal("status"), data: Type.Object({ status: SessionStatus }) }),
  Type.Object({ event: Type.Literal("event"), data: SessionEvent }),
  Type.Object({ event: Type.Literal("model"), data: RuntimeModel }),
  Type.Object({ event: Type.Literal("thinking_level"), data: Type.Object({ level: Type.String() }) }),
  Type.Object({ event: Type.Literal("fast"), data: Type.Object({ fast: Type.Boolean() }) }),
  Type.Object({ event: Type.Literal("closed"), data: Type.Object({}) }),
], { $id: "SessionStreamFrame" });
export type SessionStreamFrame = Static<typeof SessionStreamFrame>;

export const SessionOpenResponse = Type.Object({
  session: SessionView, transcript: Type.Array(TranscriptEntry), snapshot: SessionSnapshot,
}, { $id: "SessionOpenResponse" });
export type SessionOpenResponse = Static<typeof SessionOpenResponse>;

export const SessionClearResponse = Type.Object({ snapshot: SessionSnapshot }, { $id: "SessionClearResponse" });
export type SessionClearResponse = Static<typeof SessionClearResponse>;

export const routeSchemas = [
  { method: "GET", path: "/__hui/sessions/:id/events", response: SessionStreamFrame, events: SessionStreamFrame },
  { method: "POST", path: "/__hui/sessions/:id/open", response: SessionOpenResponse },
  { method: "POST", path: "/__hui/sessions/:id/clear", response: SessionClearResponse },
  { method: "POST", path: "/__hui/sessions/:id/connect", response: SessionConnectResponse, events: SessionStreamFrame },
];
