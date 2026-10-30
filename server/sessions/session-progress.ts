/**
 * Keeps every session's Task progress card current: one refresh at a time, queued
 * by each settled turn and by a timer over the sessions whose turn is still going.
 * Generating the card itself lives in `progress-card.ts`.
 */
import { homedir } from "node:os";
import type { ProgressCard } from "../api/sessions.ts";
import type { Settings } from "../hui-settings.ts";
import { recordDiagnosticEvent } from "../observability.ts";
import type { TranscriptEntry } from "../runtimes/types.ts";
import type { runPiUtilityPrompt } from "../runtimes/pi.ts";
import { generateProgressCard } from "./progress-card.ts";

/** How often a session whose turn is still going gets a fresh card. */
const PROGRESS_REFRESH_MS = 5 * 60_000;

/** The registry facts a refresh needs about a session; nothing else is read from it. */
export type ProgressSession = { cwd: string; worker?: string; parentId?: string };

export type SessionProgressDeps = {
  settings: () => Promise<Settings>;
  session: (id: string) => Promise<ProgressSession | undefined>;
  transcript: (id: string) => readonly TranscriptEntry[];
  /** Sessions whose turn is going right now. */
  running: () => readonly string[];
  save: (id: string, card: ProgressCard) => Promise<void>;
  run?: typeof runPiUtilityPrompt;
  intervalMs?: number;
};

/** Keeps every session's card current. One refresh runs at a time, and a session with a refresh still waiting keeps
 * only its newest transcript: a slow model call delays cards but never piles work up, and a card a later turn wrote is
 * never replaced by an earlier one. */
export class SessionProgress {
  #deps: SessionProgressDeps;
  /** The newest transcript waiting for a refresh, per session; bounded by the sessions that exist. */
  #waiting = new Map<string, readonly TranscriptEntry[]>();
  #draining = false;
  #timer: ReturnType<typeof setInterval> | undefined;

  constructor(deps: SessionProgressDeps) {
    this.#deps = deps;
  }

  /** A settled turn. Never awaited by the run that settled: the card is not part of the reply. */
  settled(id: string, transcript: readonly TranscriptEntry[]): void {
    this.#enqueue(id, transcript);
  }

  /** Starts asking again for every session still running. */
  start(): void {
    if (this.#timer) return;
    this.#timer = setInterval(() => {
      for (const id of this.#deps.running()) this.#enqueue(id, this.#deps.transcript(id));
    }, this.#deps.intervalMs ?? PROGRESS_REFRESH_MS);
    this.#timer.unref();
  }

  #enqueue(id: string, transcript: readonly TranscriptEntry[]): void {
    this.#waiting.set(id, transcript);
    if (this.#draining) return;
    this.#draining = true;
    void this.#drain();
  }

  async #drain(): Promise<void> {
    try {
      for (const [id, transcript] of this.#waiting) {
        this.#waiting.delete(id);
        try {
          await this.#update(id, transcript);
        } catch (error) {
          recordDiagnosticEvent({
            area: "session",
            level: "warning",
            action: "session_progress_failed",
            summary: error instanceof Error ? error.message : "Could not update a session's progress card.",
            sessionId: id,
          });
        }
      }
    } finally {
      this.#draining = false;
    }
  }

  async #update(id: string, transcript: readonly TranscriptEntry[]): Promise<void> {
    // A subagent's card is its parent's work, and costs a model call nobody reads.
    const session = await this.#deps.session(id);
    if (!session || session.parentId) return;
    const card = await generateProgressCard({
      // A remote session's checkout is not on this machine; the utility call runs here.
      cwd: session.worker ? homedir() : session.cwd,
      settings: await this.#deps.settings(),
      transcript,
      ...(this.#deps.run ? { run: this.#deps.run } : {}),
    });
    if (card) await this.#deps.save(id, card);
  }
}
