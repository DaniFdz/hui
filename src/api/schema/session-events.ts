/** Generated from docs/api.schema.json by scripts/api-schema.ts. Do not edit. */
import type { QuestionnaireQuestion, SessionStatus, SessionView, SubagentStatus, TranscriptMetrics } from "./sessions.ts";

export type CompactionReason = ("manual") | ("threshold") | ("overflow");

export type QueuedMessage = { "id": string; "text": string; "mode": "followUp"; };

export type RuntimeCommand = { "name": string; "description": string; "source": ("extension") | ("skill") | ("prompt"); };

export type RuntimeCompaction = { "status": ("running") | ("failed") | ("cancelled"); "reason": CompactionReason; "message"?: string; "blocking"?: false; "background"?: true; };

export type RuntimeModel = { "provider": string; "id": string; "name": string; "contextWindow"?: number; "maxTokens"?: number; "thinkingLevels"?: Array<string>; "fast"?: true; };

export type RuntimeQuestion = ({ "id": string; "method": "select"; "title": string; "message"?: string; "options": Array<string>; "timeout"?: number; }) | ({ "id": string; "method": "confirm"; "title": string; "message": string; "timeout"?: number; }) | ({ "id": string; "method": "input"; "title": string; "placeholder"?: string; "timeout"?: number; }) | ({ "id": string; "method": "editor"; "title": string; "prefill"?: string; "timeout"?: number; });

export type RuntimeQueue = { "steering": Array<string>; "followUp": Array<string>; "items"?: Array<QueuedMessage>; };

export type RuntimeUsage = { "contextTokens": (number) | (null); "contextWindow": number; "percent": (number) | (null); "inputTokens": number; "outputTokens": number; "costUsd": (number) | (null); };

export type SessionClearResponse = { "snapshot": SessionSnapshot; };

export type SessionEvent = ({ "type": "text"; "delta": string; }) | ({ "type": "thinking"; "delta": string; }) | ({ "type": "tool_start"; "id": string; "name": string; "args"?: unknown; }) | ({ "type": "tool_update"; "id": string; "name": string; "output"?: string; "details"?: unknown; }) | ({ "type": "tool_end"; "id": string; "name": string; "output"?: string; "details"?: unknown; "failed"?: boolean; }) | ({ "type": "queue_update"; "queue": RuntimeQueue; }) | ({ "type": "question"; "question": SessionQuestion; }) | ({ "type": "notice"; "message": string; "level": ("info") | ("warning") | ("error"); }) | ({ "type": "turn_start"; }) | ({ "type": "turn_end"; }) | ({ "type": "compaction_start"; "reason": CompactionReason; "blocking"?: false; "background"?: true; }) | ({ "type": "compaction_end"; "reason": CompactionReason; "outcome": ("done") | ("failed") | ("cancelled"); "willRetry": boolean; "message"?: string; }) | ({ "type": "settled"; "historyRefreshed"?: boolean; }) | ({ "type": "error"; "message": string; });

export type SessionOpenResponse = { "session": SessionView; "transcript": Array<TranscriptEntry>; "snapshot": SessionSnapshot; };

export type SessionQuestion = (RuntimeQuestion) | ({ "id": string; "method": "secret"; "title": string; "message": string; }) | ({ "id": string; "method": "questionnaire"; "title": string; "questions": Array<QuestionnaireQuestion>; });

export type SessionSnapshot = { "transcript": Array<TranscriptEntry>; "status": SessionStatus; "model"?: RuntimeModel; "usage"?: RuntimeUsage; "thinking"?: string; "fast"?: boolean; "queue": RuntimeQueue; "questions": Array<SessionQuestion>; "subagents": Array<SubagentTaskView>; "suggestions"?: Array<{ "id": string; "title": string; "problem": string; "fix": string; "cwd": string; "worker"?: string; "createdAt": string; }>; "watchers"?: Array<{ "id": string; "purpose": string; "target": string; "outcome": string; "command": string; "logPath": string; "state": ("running") | ("done") | ("failed") | ("stopped") | ("dead"); "pid": (number) | (null); "exitCode"?: number; "startedAt": string; "endedAt"?: string; "lastLine": string; "keepRunning"?: true; }>; "compaction"?: RuntimeCompaction; };

export type SessionStreamFrame = ({ "event": "snapshot"; "data": SessionSnapshot; }) | ({ "event": "transcript"; "data": Array<TranscriptEntry>; }) | ({ "event": "status"; "data": { "status": SessionStatus; }; }) | ({ "event": "event"; "data": SessionEvent; }) | ({ "event": "model"; "data": RuntimeModel; }) | ({ "event": "thinking_level"; "data": { "level": string; }; }) | ({ "event": "fast"; "data": { "fast": boolean; }; }) | ({ "event": "closed"; "data": Record<string, unknown>; });

export type SubagentTaskView = { "taskId": string; "sessionId": string; "parentSessionId": string; "title": string; "task": string; "status": (SubagentStatus) | ("queued"); "startedAt": string; "updatedAt": string; "endedAt"?: string; "summary"?: string; "error"?: string; };

export type TranscriptAttachment = { "name": string; "kind": ("image") | ("file"); "mimeType"?: string; "url"?: string; };

export type TranscriptEntry = ({ "metrics"?: TranscriptMetrics; "kind": "message"; "role": ("user") | ("assistant"); "text": string; "entryId"?: string; "attachments"?: Array<TranscriptAttachment>; }) | ({ "metrics"?: TranscriptMetrics; "kind": "call"; "call": string; "bot"?: string; "startedAt": number; "endedAt": number; "summary"?: string; "summaryUnavailable"?: true; "lines": Array<{ "role": ("user") | ("assistant") | ("helper") | ("handoff"); "text": string; "at": number; "request"?: string; }>; }) | ({ "metrics"?: TranscriptMetrics; "kind": "compaction"; "summary": string; "tokensBefore": number; }) | ({ "metrics"?: TranscriptMetrics; "kind": "thinking"; "text": string; }) | ({ "metrics"?: TranscriptMetrics; "kind": "tool"; "id": string; "name": string; "args"?: unknown; "output"?: string; "details"?: unknown; "failed"?: boolean; }) | ({ "metrics"?: TranscriptMetrics; "kind": "error"; "message": string; });
