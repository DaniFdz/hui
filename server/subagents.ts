/** Session-tree coordination modeled after OpenClaw's session tools. */
import { randomUUID } from "node:crypto";

import {
  liveSessions,
  type LiveSessions,
  type SessionStatus,
  type SubagentTaskView,
} from "./live-sessions.ts";
import { recordDiagnosticEvent } from "./observability.ts";
import {
  readRegistry,
  updateRegistry,
  type SessionRecord,
  type SubagentStatus,
} from "./sessions.ts";
import type { TranscriptEntry } from "./runtimes/types.ts";
import { formatSubagentCompletionEvent, SUBAGENT_COMPLETION_MARKER, type SubagentCompletionItem } from "../src/lib/subagent-completion.ts";

const MAX_ACTIVE_SUBAGENTS = 8;
const READY_TIMEOUT_MS = 30_000;
const DELIVERY_RETRY_MS = 5_000;
const HISTORY_MAX_BYTES = 80 * 1024;
const OVERSIZED_HISTORY_ENTRY: TranscriptEntry = {
  kind: "error",
  message: "A transcript entry was omitted because it exceeds the session history limit.",
};
const ACTIVE_STATUSES = new Set<SubagentStatus>(["starting", "running"]);
const THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh"]);

type SessionAccess = Pick<
  LiveSessions,
  | "abort"
  | "accept"
  | "close"
  | "ensure"
  | "followUp"
  | "models"
  | "notifySnapshot"
  | "prompt"
  | "release"
  | "setSubagentSnapshotProvider"
  | "snapshot"
  | "status"
  | "steer"
  | "transcript"
  | "watch"
>;

type RunControl = {
  settle: (status: SubagentStatus, error?: string) => void;
};

export class AgentToolInputError extends Error {
  override name = "AgentToolInputError";
}

function text(
  params: Record<string, unknown>,
  key: string,
  maximum: number,
  optional = false,
): string | undefined {
  const raw = params[key];
  if (raw === undefined && optional) return undefined;
  if (typeof raw !== "string") throw new AgentToolInputError(`${key} must be text.`);
  const value = raw.trim();
  if (!value || value.length > maximum) {
    throw new AgentToolInputError(`${key} must be 1-${maximum} characters.`);
  }
  return value;
}

function integer(
  params: Record<string, unknown>,
  key: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const raw = params[key];
  if (raw === undefined) return fallback;
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < minimum || raw > maximum) {
    throw new AgentToolInputError(`${key} must be an integer from ${minimum} to ${maximum}.`);
  }
  return raw;
}

function rootSessionId(records: readonly SessionRecord[], sessionId: string): string {
  const byId = new Map(records.map((record) => [record.id, record]));
  let current = byId.get(sessionId);
  if (!current) throw new AgentToolInputError(`Unknown session: ${sessionId}`);
  const seen = new Set<string>();
  while (current.parentId && byId.has(current.parentId) && !seen.has(current.id)) {
    seen.add(current.id);
    current = byId.get(current.parentId)!;
  }
  return current.id;
}

function visibleTree(records: readonly SessionRecord[], callerId: string): SessionRecord[] {
  const root = rootSessionId(records, callerId);
  return records.filter((record) => rootSessionId(records, record.id) === root);
}

function taskView(record: SessionRecord): SubagentTaskView | undefined {
  if (!record.parentId || !record.subagent) return undefined;
  return {
    taskId: record.subagent.taskId,
    sessionId: record.id,
    parentSessionId: record.parentId,
    title: record.title,
    task: record.subagent.task,
    status: record.subagent.status,
    startedAt: record.subagent.startedAt,
    updatedAt: record.subagent.updatedAt,
    ...(record.subagent.endedAt ? { endedAt: record.subagent.endedAt } : {}),
    ...(record.subagent.summary ? { summary: record.subagent.summary } : {}),
    ...(record.subagent.error ? { error: record.subagent.error } : {}),
  };
}

function truncate(value: string, maximum: number): string {
  return value.length <= maximum ? value : `${value.slice(0, maximum - 1)}…`;
}

function lastAssistant(entries: readonly TranscriptEntry[]): string {
  const entry = entries.findLast((item) => item.kind === "message" && item.role === "assistant");
  return entry?.kind === "message" ? entry.text.trim() : "";
}

function boundedHistory(entries: readonly TranscriptEntry[], limit: number): TranscriptEntry[] {
  const selected: TranscriptEntry[] = [];
  let bytes = 2;
  for (const entry of entries.slice(-limit).toReversed()) {
    const serialized = JSON.stringify(entry);
    const candidate = Buffer.byteLength(serialized, "utf8") > HISTORY_MAX_BYTES - 2
      ? OVERSIZED_HISTORY_ENTRY
      : entry;
    const candidateBytes = Buffer.byteLength(JSON.stringify(candidate), "utf8");
    const separatorBytes = selected.length > 0 ? 1 : 0;
    if (bytes + separatorBytes + candidateBytes > HISTORY_MAX_BYTES) break;
    bytes += separatorBytes + candidateBytes;
    selected.push(candidate);
  }
  return selected.reverse();
}

export class SubagentService {
  #tasks = new Map<string, SubagentTaskView[]>();
  #controls = new Map<string, RunControl>();
  #timers = new Set<ReturnType<typeof setTimeout>>();
  #disposed = false;
  #deliveryFlights = new Map<string, Promise<void>>();
  #admitted = new Map<string, string>();
  #deliveryTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly sessions: SessionAccess;
  private readonly registryReader: typeof readRegistry;
  private readonly registryUpdater: typeof updateRegistry;
  private readonly now: () => Date;
  private readonly uuid: () => string;

  constructor(
    sessions: SessionAccess = liveSessions,
    registryReader: typeof readRegistry = readRegistry,
    registryUpdater: typeof updateRegistry = updateRegistry,
    now: () => Date = () => new Date(),
    uuid: () => string = randomUUID,
  ) {
    this.sessions = sessions;
    this.registryReader = registryReader;
    this.registryUpdater = registryUpdater;
    this.now = now;
    this.uuid = uuid;
    sessions.setSubagentSnapshotProvider((parentId) => this.snapshot(parentId));
  }

  async initialize(): Promise<void> {
    const now = this.now().toISOString();
    const records = await this.registryUpdater((current) => current.map((record) =>
      record.subagent && ACTIVE_STATUSES.has(record.subagent.status)
        ? {
            ...record,
            subagent: {
              ...record.subagent,
              status: "interrupted" as const,
              completionDelivery: "pending" as const,
              updatedAt: now,
              endedAt: now,
              error: "The HUI gateway restarted before this subagent finished.",
            },
          }
        : record,
    ));
    this.#replaceCache(records);
    // Startup must not wait for a parent model/runtime to become available.
    this.#scheduleDelivery();
  }

  dispose(): void {
    this.#disposed = true;
    if (this.#deliveryTimer) clearTimeout(this.#deliveryTimer);
    this.#deliveryTimer = undefined;
    this.#admitted.clear();
    for (const timer of this.#timers) clearTimeout(timer);
    this.#timers.clear();
    for (const control of this.#controls.values()) control.settle("interrupted");
    this.#controls.clear();
  }

  snapshot(parentId: string): readonly SubagentTaskView[] {
    return this.#tasks.get(parentId) ?? [];
  }

  /** Drop task projections after a registry subtree was durably removed. */
  forgetSessions(ids: ReadonlySet<string>): void {
    for (const [parentId, tasks] of this.#tasks) {
      const kept = tasks.filter((task) => {
        if (!ids.has(parentId) && !ids.has(task.sessionId)) return true;
        this.#admitted.delete(task.taskId);
        return false;
      });
      if (kept.length === tasks.length) continue;
      if (kept.length) this.#tasks.set(parentId, kept);
      else this.#tasks.delete(parentId);
      if (!ids.has(parentId)) this.sessions.notifySnapshot(parentId);
    }
  }

  async handle(
    callerSessionId: string,
    action: string,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    if (this.#disposed) throw new Error("Subagent service is shutting down.");
    switch (action) {
      case "sessions_spawn": return this.#spawn(callerSessionId, params);
      case "sessions_list": return this.#list(callerSessionId, params);
      case "sessions_history": return this.#history(callerSessionId, params);
      case "sessions_send": return this.#send(callerSessionId, params);
      case "subagents": return this.#subagents(callerSessionId, params);
      default: throw new AgentToolInputError(`Unknown agent tool action: ${action}`);
    }
  }

  async #spawn(callerId: string, params: Record<string, unknown>) {
    const task = text(params, "task", 20_000)!;
    const label = text(params, "label", 120, true);
    const model = text(params, "model", 200, true);
    const thinking = text(params, "thinking", 16, true);
    const runTimeoutSeconds = integer(params, "runTimeoutSeconds", 0, 0, 3_600);
    if (model && !/^[^/\s]+\/\S+$/.test(model)) {
      throw new AgentToolInputError("model must use provider/id format.");
    }
    if (thinking && !THINKING_LEVELS.has(thinking)) {
      throw new AgentToolInputError(`Unsupported thinking level: ${thinking}`);
    }
    if (model) await this.#assertModelAvailable(callerId, model);
    const taskId = this.uuid();
    const sessionId = this.uuid();
    const now = this.now().toISOString();
    let child: SessionRecord | undefined;
    const records = await this.registryUpdater((current) => {
      const caller = current.find((record) => record.id === callerId);
      if (!caller) throw new AgentToolInputError(`Unknown caller session: ${callerId}`);
      const root = rootSessionId(current, callerId);
      const active = current.filter((record) =>
        record.subagent && ACTIVE_STATUSES.has(record.subagent.status) &&
        rootSessionId(current, record.id) === root,
      ).length;
      if (active >= MAX_ACTIVE_SUBAGENTS) {
        throw new AgentToolInputError(`At most ${MAX_ACTIVE_SUBAGENTS} subagents may run in one session tree.`);
      }
      child = {
        id: sessionId,
        title: label ?? truncate(task.replace(/\s+/g, " "), 72),
        group: caller.group,
        ...(caller.archived ? { archived: true } : {}),
        cwd: caller.cwd,
        // A remote session's children run on the same worker.
        ...(caller.worker ? { worker: caller.worker } : {}),
        tool: caller.tool,
        model: model ?? caller.model,
        thinking: thinking ?? caller.thinking,
        parentId: caller.id,
        subagent: {
          taskId,
          task,
          ...(label ? { label } : {}),
          status: "starting",
          startedAt: now,
          updatedAt: now,
        },
        createdAt: now,
        updatedAt: now,
        source: "hui",
      };
      return [
        ...current.map((record) => record.id === caller.id ? { ...record, updatedAt: now } : record),
        child,
      ];
    });
    this.#replaceCache(records);
    // A fresh UUID has no old tombstone to clear. Preserve any concurrent
    // ancestor deletion that committed after registration and before launch.
    this.sessions.ensure(child!);
    recordDiagnosticEvent({
      area: "session",
      level: "info",
      action: "subagent_spawn",
      summary: `Spawned subagent: ${child!.title}`,
      sessionId: callerId,
    });
    void this.#run(child!, runTimeoutSeconds).catch((error: unknown) => {
      recordDiagnosticEvent({
        area: "session",
        level: "error",
        action: "subagent_run_failed",
        summary: error instanceof Error ? error.message : "Could not finish subagent bookkeeping.",
        sessionId: callerId,
      });
    });
    return {
      status: "accepted",
      taskId,
      childSessionKey: sessionId,
      label: child!.title,
    };
  }

  /** Reject an unknown model before a child exists, so the caller can retry in
   * the same turn. An unavailable or empty catalog is not a reason to block. */
  async #assertModelAvailable(callerId: string, model: string): Promise<void> {
    const catalog = await this.sessions.models(callerId).catch(() => []);
    const names = catalog.map((entry) => `${entry.provider}/${entry.id}`);
    if (!names.length || names.includes(model)) return;
    const id = model.slice(model.lastIndexOf("/") + 1);
    const similar = names.filter((name) => name.endsWith(`/${id}`)).slice(0, 5);
    throw new AgentToolInputError(similar.length
      ? `Unknown model: ${model}. Did you mean ${similar.join(" or ")}?`
      : `Unknown model: ${model}. Available models include ${names.slice(0, 10).join(", ")}.`);
  }

  async #run(child: SessionRecord, runTimeoutSeconds: number): Promise<void> {
    const taskId = child.subagent!.taskId;
    try {
      await this.#waitUntilReady(child.id);
      const current = (await this.registryReader()).find((record) => record.id === child.id);
      if (!current?.subagent || !ACTIVE_STATUSES.has(current.subagent.status)) return;
      await this.#patchTask(child.id, (record, now) => ({
        ...record,
        status: "running",
        updatedAt: now,
      }));
      const completion = this.#waitForCompletion(child, runTimeoutSeconds);
      try {
        await this.sessions.prompt(child.id, `[Subagent Task]\n${child.subagent!.task}`);
      } catch (error) {
        completion.cancel();
        throw error;
      }
      const outcome = await completion.promise;
      const summary = outcome.status === "completed"
        ? truncate(lastAssistant(this.sessions.transcript(child.id)), 20_000)
        : "";
      await this.#finishTask(child.id, outcome.status, summary, outcome.error);
    } catch (error) {
      await this.#finishTask(
        child.id,
        "failed",
        "",
        error instanceof Error ? error.message : "The subagent failed.",
      );
    } finally {
      this.#controls.delete(taskId);
    }
  }

  #waitForCompletion(child: SessionRecord, runTimeoutSeconds: number): {
    promise: Promise<{ status: SubagentStatus; error?: string }>;
    cancel: () => void;
  } {
    let unsubscribe = () => {};
    let timer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    let resolvePromise!: (value: { status: SubagentStatus; error?: string }) => void;
    const cleanup = () => {
      unsubscribe();
      if (timer) {
        clearTimeout(timer);
        this.#timers.delete(timer);
      }
      this.#controls.delete(child.subagent!.taskId);
    };
    const settle = (status: SubagentStatus, error?: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolvePromise({ status, ...(error ? { error } : {}) });
    };
    const promise = new Promise<{ status: SubagentStatus; error?: string }>((resolve) => {
      resolvePromise = resolve;
      const watched = this.sessions.watch(child.id, (message) => {
        if (message.kind === "event" && message.event.type === "settled") settle("completed");
        else if (message.kind === "status" && message.status === "error") {
          settle("failed", "The subagent runtime failed.");
        } else if (message.kind === "status" && message.status === "disconnected") {
          settle("failed", "HUI is disconnected from the machine the subagent runs on.");
        } else if (message.kind === "closed") {
          settle("failed", "The subagent runtime exited.");
        }
      });
      unsubscribe = watched.unsubscribe;
      if (runTimeoutSeconds > 0) {
        timer = setTimeout(() => {
          settle("timed_out", `The subagent exceeded ${runTimeoutSeconds} seconds.`);
          void this.sessions.abort(child.id).catch(() => undefined);
        }, runTimeoutSeconds * 1_000);
        this.#timers.add(timer);
      }
    });
    this.#controls.set(child.subagent!.taskId, { settle });
    return { promise, cancel: () => settle("failed", "The subagent prompt was rejected.") };
  }

  async #finishTask(
    sessionId: string,
    status: SubagentStatus,
    summary = "",
    error = "",
  ): Promise<void> {
    let finished = false;
    const now = this.now().toISOString();
    const records = await this.registryUpdater((current) => current.map((record) => {
      if (record.id !== sessionId || !record.subagent || !ACTIVE_STATUSES.has(record.subagent.status)) {
        return record;
      }
      finished = true;
      return {
        ...record,
        updatedAt: now,
        subagent: {
          ...record.subagent,
          status,
          updatedAt: now,
          endedAt: now,
          completionDelivery: "pending",
          ...(summary ? { summary } : {}),
          ...(error ? { error } : {}),
        },
      };
    }));
    if (!finished) return;
    // Request release before publishing the terminal snapshot. A caller that
    // reacts to that snapshot may immediately reopen the durable session;
    // publishing first would let this cleanup race with the new runtime.
    this.sessions.release(sessionId);
    this.#replaceCache(records);
    // Shutdown deliberately settles in-memory controls. The next gateway marks
    // unfinished records interrupted; do not wake a parent while this one is
    // tearing its runtimes down.
    if (this.#disposed) return;
    const child = records.find((record) => record.id === sessionId);
    if (!child?.parentId) return;
    recordDiagnosticEvent({
      area: "session",
      level: status === "completed" ? "info" : "warning",
      action: "subagent_finish",
      summary: `Subagent ${status}: ${child.title}`,
      sessionId: child.parentId,
    });
    await this.flushCompletions();
  }

  #scheduleDelivery(): void {
    if (this.#disposed || this.#deliveryTimer) return;
    this.#deliveryTimer = setTimeout(() => {
      this.#deliveryTimer = undefined;
      void this.flushCompletions();
    }, DELIVERY_RETRY_MS);
    this.#deliveryTimer.unref();
  }

  /** Retry the durable outbox. Single-flight per parent; no competing turns. */
  async flushCompletions(): Promise<void> {
    if (this.#disposed) return;
    let pending = false;
    try {
      const records = await this.registryReader();
      const parents = new Set(records.filter((record) =>
        record.parentId && record.subagent?.completionDelivery === "pending" &&
        !ACTIVE_STATUSES.has(record.subagent.status)).map((record) => record.parentId!));
      pending = parents.size > 0;
      await Promise.all([...parents].map((parentId) => {
        const running = this.#deliveryFlights.get(parentId);
        if (running) return running;
        const flight = this.#deliverParent(parentId).catch((error: unknown) => {
          recordDiagnosticEvent({ area: "session", level: "warning", action: "subagent_delivery_retry",
            summary: error instanceof Error ? error.message : "Subagent delivery failed; retained for retry.",
            sessionId: parentId });
        }).finally(() => this.#deliveryFlights.delete(parentId));
        this.#deliveryFlights.set(parentId, flight);
        return flight;
      }));
    } catch (error) {
      pending = true;
      recordDiagnosticEvent({ area: "session", level: "warning", action: "subagent_delivery_retry",
        summary: error instanceof Error ? error.message : "Could not read completion outbox." });
    } finally {
      if (pending) this.#scheduleDelivery();
    }
  }

  async #deliverParent(parentId: string): Promise<void> {
    const records = await this.registryReader();
    const candidates = records.filter((record) => record.parentId === parentId &&
      record.subagent?.completionDelivery === "pending" && !ACTIVE_STATUSES.has(record.subagent.status));
    const parent = records.find((record) => record.id === parentId);
    if (!parent || !candidates.length || this.#disposed) return;
    if (!this.sessions.ensure(parent)) throw new Error("Parent runtime is unavailable; completion retained.");
    await this.#waitUntilReady(parentId);
    if (this.#disposed) return;

    // Admission to a volatile runtime queue is not delivery. Only acknowledge
    // IDs observed in the hydrated transcript; this also handles a crash after
    // PI wrote the event but before HUI saved the acknowledgement.
    const observed = new Set<string>();
    for (const entry of this.sessions.transcript(parentId)) {
      if (entry.kind !== "message" || entry.role !== "user" ||
          !entry.text.startsWith(`${SUBAGENT_COMPLETION_MARKER}\ndelivery_ids: `)) continue;
      try {
        const ids: unknown = JSON.parse(entry.text.split("\n")[1]!.slice("delivery_ids: ".length));
        if (Array.isArray(ids)) for (const id of ids) if (typeof id === "string") observed.add(id);
      } catch { /* Unrecognized transcript content cannot acknowledge a task. */ }
    }
    const confirmed = candidates.filter((record) => observed.has(record.subagent!.taskId));
    if (confirmed.length) {
      const ids = new Set(confirmed.map((record) => record.subagent!.taskId));
      const updated = await this.registryUpdater((current) => current.map((record) =>
        record.parentId === parentId && record.subagent?.completionDelivery === "pending" && ids.has(record.subagent.taskId)
          ? { ...record, subagent: { ...record.subagent, completionDelivery: "delivered" as const } } : record));
      for (const id of ids) this.#admitted.delete(id);
      this.#replaceCache(updated);
    }
    if (records.some((record) => record.parentId === parentId && record.subagent && ACTIVE_STATUSES.has(record.subagent.status))) return;
    const queue = this.sessions.snapshot(parentId).queue;
    const busy = ["running", "waiting"].includes(this.sessions.status(parentId));
    const remaining = candidates.filter((record) => {
      const id = record.subagent!.taskId;
      if (observed.has(id)) return false;
      const admitted = this.#admitted.get(id);
      // A busy turn may already have consumed steering while the transcript
      // projection is waiting for settlement. Never inject it twice mid-turn.
      if (admitted && (busy || queue.steering.includes(admitted) || queue.followUp.includes(admitted))) return false;
      return true;
    });
    if (!remaining.length || this.#disposed) return;
    const items: SubagentCompletionItem[] = remaining.map((record) => ({
      sessionId: record.id, title: record.title, task: record.subagent!.task,
      status: record.subagent!.status, startedAt: record.subagent!.startedAt,
      ...(record.subagent!.endedAt ? { endedAt: record.subagent!.endedAt } : {}),
      result: record.subagent!.summary || record.subagent!.error || `Subagent ended with status ${record.subagent!.status}.`,
    }));
    const ids = remaining.map((record) => record.subagent!.taskId);
    const message = formatSubagentCompletionEvent(items).replace(SUBAGENT_COMPLETION_MARKER,
      `${SUBAGENT_COMPLETION_MARKER}\ndelivery_ids: ${JSON.stringify(ids)}`);
    if (busy) {
      try {
        await this.sessions.steer(parentId, message);
      } catch {
        if (this.#disposed) return;
        if (this.sessions.status(parentId) === "idle") await this.sessions.prompt(parentId, message);
        else await this.sessions.followUp(parentId, message);
      }
    } else {
      await this.sessions.prompt(parentId, message);
    }
    for (const id of ids) this.#admitted.set(id, message);
  }

  async #list(callerId: string, params: Record<string, unknown>) {
    const limit = integer(params, "limit", 50, 1, 100);
    const records = await this.registryReader();
    const visible = visibleTree(records, callerId)
      .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, limit);
    return {
      count: visible.length,
      sessions: visible.map((record) => ({
        sessionKey: record.id,
        title: record.title,
        parentSessionKey: record.parentId ?? null,
        runtimeStatus: this.sessions.status(record.id),
        subagentStatus: record.subagent?.status ?? null,
        updatedAt: record.updatedAt,
      })),
    };
  }

  async #history(callerId: string, params: Record<string, unknown>) {
    const sessionKey = text(params, "sessionKey", 200)!;
    const limit = integer(params, "limit", 20, 1, 100);
    const includeTools = params["includeTools"] === true;
    const target = await this.#authorizedTarget(callerId, sessionKey);
    if (!this.sessions.ensure(target)) throw new AgentToolInputError(`Unknown session: ${sessionKey}`);
    if (this.sessions.status(target.id) === "starting") await this.#waitUntilReady(target.id);
    const transcript = this.sessions.transcript(target.id)
      .filter((entry) => includeTools || entry.kind !== "tool");
    return {
      sessionKey: target.id,
      title: target.title,
      status: this.sessions.status(target.id),
      messages: boundedHistory(transcript, limit),
    };
  }

  async #send(callerId: string, params: Record<string, unknown>) {
    const sessionKey = text(params, "sessionKey", 200)!;
    const message = text(params, "message", 20_000)!;
    const timeoutSeconds = integer(params, "timeoutSeconds", 30, 0, 120);
    if (callerId === sessionKey && timeoutSeconds > 0) {
      throw new AgentToolInputError("A session cannot synchronously wait for a reply from itself.");
    }
    const [caller, target] = await Promise.all([
      this.#authorizedTarget(callerId, callerId),
      this.#authorizedTarget(callerId, sessionKey),
    ]);
    if (!this.sessions.ensure(target)) throw new AgentToolInputError(`Unknown session: ${sessionKey}`);
    if (this.sessions.status(target.id) === "starting") await this.#waitUntilReady(target.id);
    const delivered = `[Inter-session message from ${caller.title} (${caller.id})]\n${message}`;
    const baseline = this.sessions.transcript(target.id).length;
    const reply = timeoutSeconds > 0
      ? this.#waitForReply(target.id, delivered, baseline, timeoutSeconds * 1_000)
      : undefined;
    try {
      const state = this.sessions.status(target.id);
      if (state === "running" || state === "waiting") {
        await this.sessions.followUp(target.id, delivered);
      } else {
        await this.sessions.prompt(target.id, delivered);
      }
    } catch (error) {
      reply?.cancel();
      throw error;
    }
    if (!reply) return { status: "accepted", sessionKey: target.id };
    return { status: "ok", sessionKey: target.id, reply: await reply.promise };
  }

  #waitForReply(
    sessionId: string,
    prompt: string,
    baseline: number,
    timeoutMs: number,
  ): { promise: Promise<string>; cancel: () => void } {
    let unsubscribe = () => {};
    let timer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    let rejectPromise!: (error: Error) => void;
    const cleanup = () => {
      unsubscribe();
      if (timer) {
        clearTimeout(timer);
        this.#timers.delete(timer);
      }
    };
    const readReply = (): string | undefined => {
      const entries = this.sessions.transcript(sessionId);
      const promptIndex = entries.findIndex((entry, index) =>
        index >= baseline && entry.kind === "message" && entry.role === "user" && entry.text === prompt,
      );
      if (promptIndex < 0) return undefined;
      const answer = entries.slice(promptIndex + 1)
        .findLast((entry) => entry.kind === "message" && entry.role === "assistant");
      return answer?.kind === "message" && answer.text.trim() ? answer.text.trim() : undefined;
    };
    const promise = new Promise<string>((resolve, reject) => {
      rejectPromise = reject;
      const check = () => {
        const answer = readReply();
        if (!answer || settled) return;
        settled = true;
        cleanup();
        resolve(answer);
      };
      const watched = this.sessions.watch(sessionId, (stream) => {
        if (stream.kind === "closed") {
          if (!settled) {
            settled = true;
            cleanup();
            reject(new Error("The target session exited before replying."));
          }
          return;
        }
        check();
      });
      unsubscribe = watched.unsubscribe;
      timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error(`No reply within ${Math.round(timeoutMs / 1_000)} seconds.`));
      }, timeoutMs);
      this.#timers.add(timer);
      check();
    });
    return {
      promise,
      cancel: () => {
        if (settled) return;
        settled = true;
        cleanup();
        rejectPromise(new Error("Message delivery failed."));
      },
    };
  }

  async #subagents(callerId: string, params: Record<string, unknown>) {
    const action = text(params, "action", 20)!;
    const records = await this.registryReader();
    const visible = visibleTree(records, callerId).filter((record) => record.subagent);
    if (action === "list") {
      return {
        count: visible.length,
        subagents: visible.map((record) => ({
          taskId: record.subagent!.taskId,
          sessionKey: record.id,
          parentSessionKey: record.parentId,
          label: record.title,
          task: record.subagent!.task,
          status: record.subagent!.status,
          updatedAt: record.subagent!.updatedAt,
        })),
      };
    }
    if (action !== "steer" && action !== "kill") {
      throw new AgentToolInputError("subagents action must be list, steer, or kill.");
    }
    const targetKey = text(params, "target", 200)!;
    const target = visible.find((record) =>
      record.id === targetKey || record.subagent?.taskId === targetKey,
    );
    if (!target?.subagent) throw new AgentToolInputError(`Unknown visible subagent: ${targetKey}`);
    if (!ACTIVE_STATUSES.has(target.subagent.status)) {
      throw new AgentToolInputError(`Subagent ${target.id} is already ${target.subagent.status}.`);
    }
    if (action === "steer") {
      const message = text(params, "message", 20_000)!;
      if (this.sessions.status(target.id) !== "running") {
        throw new AgentToolInputError("The subagent is not running yet.");
      }
      await this.sessions.steer(target.id, `[Parent steering]\n${message}`);
      return { status: "steered", sessionKey: target.id, taskId: target.subagent.taskId };
    }
    this.#controls.get(target.subagent.taskId)?.settle("cancelled");
    if (this.sessions.status(target.id) === "running" || this.sessions.status(target.id) === "waiting") {
      await this.sessions.abort(target.id).catch(() => undefined);
    }
    await this.#finishTask(target.id, "cancelled", "", "Cancelled by another agent.");
    return { status: "cancelled", sessionKey: target.id, taskId: target.subagent.taskId };
  }

  async #authorizedTarget(callerId: string, targetId: string): Promise<SessionRecord> {
    const records = await this.registryReader();
    const target = visibleTree(records, callerId).find((record) => record.id === targetId);
    if (!target) throw new AgentToolInputError(`Session ${targetId} is outside the current agent tree.`);
    return target;
  }

  #waitUntilReady(sessionId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        watched.unsubscribe();
        if (timer) {
          clearTimeout(timer);
          this.#timers.delete(timer);
        }
        if (error) reject(error);
        else resolve();
      };
      const inspect = (status: SessionStatus) => {
        if (status === "idle" || status === "running" || status === "waiting") finish();
        else if (status === "error") finish(new Error("The target runtime could not start."));
        else if (status === "disconnected") finish(new Error("The target runtime's machine is disconnected."));
      };
      const watched = this.sessions.watch(sessionId, (message) => {
        if (message.kind === "status") inspect(message.status);
        else if (message.kind === "snapshot") inspect(message.snapshot.status);
        else if (message.kind === "closed") finish(new Error("The target runtime exited."));
      });
      timer = setTimeout(() => finish(new Error("The target runtime did not start in time.")), READY_TIMEOUT_MS);
      this.#timers.add(timer);
      inspect(watched.snapshot.status);
    });
  }

  async #patchTask(
    sessionId: string,
    mutate: (
      task: NonNullable<SessionRecord["subagent"]>,
      now: string,
    ) => NonNullable<SessionRecord["subagent"]>,
  ): Promise<SessionRecord[]> {
    const now = this.now().toISOString();
    const records = await this.registryUpdater((current) => current.map((record) =>
      record.id === sessionId && record.subagent
        ? { ...record, subagent: mutate(record.subagent, now), updatedAt: now }
        : record,
    ));
    this.#replaceCache(records);
    return records;
  }

  #replaceCache(records: readonly SessionRecord[]): void {
    const previousParents = new Set(this.#tasks.keys());
    const next = new Map<string, SubagentTaskView[]>();
    for (const record of records) {
      const view = taskView(record);
      if (!view) continue;
      const children = next.get(view.parentSessionId) ?? [];
      children.push(view);
      next.set(view.parentSessionId, children);
    }
    for (const children of next.values()) {
      children.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    }
    this.#tasks = next;
    for (const parentId of new Set([...previousParents, ...next.keys()])) {
      this.sessions.notifySnapshot(parentId);
    }
  }
}
