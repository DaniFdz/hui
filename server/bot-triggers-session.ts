/**
 * Session triggers' source (HUI-18): an Agents session finished, failed or is waiting for an answer. Every live
 * session's status change passes here; one that ends a run, fails or asks a question becomes an event for the bots
 * whose session triggers watch that session.
 *
 * Which sessions a bot may watch is decided in one place, `sessionWatchable`: for now only those it started itself.
 */
import type { SessionTriggerEvent } from "../shared/bot-triggers.ts";
import type { BotRecord } from "../shared/bots.ts";
import { InFlight } from "./bot-triggers-store.ts";
import type { LiveSessions, SessionStatus, SessionStatusUpdate } from "./live-sessions.ts";
import type { TranscriptEntry } from "./runtimes/types.ts";
import type { SessionRecord } from "./sessions.ts";

/**
 * Whether a bot's session triggers may watch `record`: today only a session the bot started itself
 * (`sessions_spawn` from its chat makes the chat the session's `parentId`), never its own chat or another bot's.
 * The owner is still deciding how far bots may reach into other sessions; widening it changes this function alone.
 */
export function sessionWatchable(bot: Pick<BotRecord, "sessionId">, record: Pick<SessionRecord, "id" | "parentId" | "bot">): boolean {
  return record.parentId === bot.sessionId && record.id !== bot.sessionId && !record.bot;
}

export type SessionEvent = { kind: SessionTriggerEvent; record: SessionRecord; summary: string; details: string; at: string };

export type SessionWatchDeps = {
  sessions: Pick<LiveSessions, "watchStatuses" | "transcript" | "snapshot">;
  readSessions(): Promise<readonly SessionRecord[]>;
  /** Whether any enabled session trigger exists now; without one a status change costs a lookup in a map. */
  wanted(): boolean;
  onEvent(event: SessionEvent): Promise<void> | void;
  now?: () => number;
  report?(error: unknown): void;
};

const oneLine = (value: string, max: number) => {
  const line = value.replace(/\s+/gu, " ").trim();
  return line.length <= max ? line : `${line.slice(0, max - 1).trimEnd()}…`;
};

function quote(body: string, max: number): string {
  const trimmed = body.replace(/\r\n?/gu, "\n").trim();
  const cut = trimmed.length > max ? `${trimmed.slice(0, max - 1).trimEnd()}…` : trimmed;
  return cut.split("\n").map((line) => `  > ${line}`).join("\n");
}

/** Whether the run that just ended ended on an error: its transcript's last entry is one. */
export function endedInError(transcript: readonly TranscriptEntry[]): string | undefined {
  const last = transcript.at(-1);
  return last?.kind === "error" ? last.message || "The run failed." : undefined;
}

/** Follows every live session's status and reports the transitions session triggers wake on. */
export class SessionWatch {
  readonly #deps: SessionWatchDeps;
  readonly #last = new Map<string, SessionStatus>();
  #unsubscribe?: () => void;
  /** Events on their way to `onEvent`: what `stop` waits for. */
  readonly #emits = new InFlight();

  constructor(deps: SessionWatchDeps) {
    this.#deps = deps;
  }

  start(): void {
    if (this.#unsubscribe) return;
    const watched = this.#deps.sessions.watchStatuses((update) => this.update(update));
    for (const status of watched.statuses) this.#last.set(status.id, status.status);
    this.#unsubscribe = watched.unsubscribe;
  }

  /** Stops following the sessions, and resolves once the events on their way have been handed to `onEvent` and settled
   * there. */
  async stop(): Promise<void> {
    this.#unsubscribe?.();
    this.#unsubscribe = undefined;
    this.#last.clear();
    await this.#emits.settled();
  }

  /** One status change: a run that ended (idle after running or waiting), a failure, or a question. */
  update({ id, status }: SessionStatusUpdate): void {
    const before = this.#last.get(id);
    this.#last.set(id, status);
    if (before === status || !this.#deps.wanted()) return;
    let kind: SessionTriggerEvent | undefined;
    if (status === "waiting") kind = "waiting";
    else if (status === "error") kind = "failed";
    else if (status === "idle" && (before === "running" || before === "waiting")) kind = endedInError(this.#deps.sessions.transcript(id)) ? "failed" : "finished";
    if (!kind) return;
    void this.#emits.track(this.#emit(id, kind).catch((error: unknown) => this.#deps.report?.(error)));
  }

  async #emit(id: string, kind: SessionTriggerEvent): Promise<void> {
    const record = (await this.#deps.readSessions()).find((candidate) => candidate.id === id);
    if (!record) return;
    const title = oneLine(record.title || "Untitled session", 80);
    const transcript = this.#deps.sessions.transcript(id);
    const lines = [`"${title}" (session ${record.id}, in ${record.cwd})`];
    let summary: string;
    if (kind === "waiting") {
      const question = this.#deps.sessions.snapshot(id).questions[0];
      summary = `"${title}" is waiting for an answer`;
      if (question) lines.push(`  Asks: ${oneLine(question.title, 300)}`);
    } else if (kind === "failed") {
      summary = `"${title}" failed`;
      const error = endedInError(transcript);
      lines.push(`  Error: ${oneLine(error ?? "its runtime failed", 400)}`);
    } else {
      summary = `"${title}" finished`;
      const reply = transcript.findLast((entry) => entry.kind === "message" && entry.role === "assistant" && entry.text.trim());
      if (reply?.kind === "message") lines.push("  Last reply:", quote(reply.text, 900));
    }
    await this.#deps.onEvent({ kind, record, summary, details: lines.join("\n"), at: new Date((this.#deps.now ?? Date.now)()).toISOString() });
  }
}
