/** Normalizes watcher snapshot rows, formats their state labels and failure notes, and reads the one event a settle
 * writes into its conversation. */
import type { Watcher, WatcherState } from "../api/schema/watchers.ts";
export type { Watcher, WatcherState } from "../api/schema/watchers.ts";

const WATCHER_LIMITS = {
  purpose: 200,
  target: 500,
  outcome: 200,
  command: 4_000,
  perSession: 10,
  logLines: 400,
  logLine: 500,
} as const;

const STATE_SET = new Set<string>(["running", "done", "failed", "stopped", "dead"]);

function text(value: unknown, maximum: number): string {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

/** Browser-side normalization of the snapshot field; drops malformed rows. */
export function parseWatchers(value: unknown): Watcher[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, WATCHER_LIMITS.perSession).flatMap((item): Watcher[] => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const row = item as Record<string, unknown>;
    const state = text(row["state"], 20);
    const pid = row["pid"];
    const exitCode = row["exitCode"];
    const watcher: Watcher = {
      id: text(row["id"], 100),
      purpose: text(row["purpose"], WATCHER_LIMITS.purpose),
      target: text(row["target"], WATCHER_LIMITS.target),
      outcome: text(row["outcome"], WATCHER_LIMITS.outcome),
      command: text(row["command"], WATCHER_LIMITS.command),
      logPath: text(row["logPath"], 4_096),
      state: (STATE_SET.has(state) ? state : "dead") as WatcherState,
      pid: typeof pid === "number" && Number.isSafeInteger(pid) && pid > 0 ? pid : null,
      ...(typeof exitCode === "number" && Number.isSafeInteger(exitCode) ? { exitCode } : {}),
      startedAt: text(row["startedAt"], 40),
      ...(text(row["endedAt"], 40) ? { endedAt: text(row["endedAt"], 40) } : {}),
      lastLine: text(row["lastLine"], WATCHER_LIMITS.logLine),
      ...(row["keepRunning"] === true ? { keepRunning: true as const } : {}),
    };
    return watcher.id && watcher.purpose && watcher.command && watcher.startedAt ? [watcher] : [];
  });
}

const STATE_LABELS: Record<WatcherState, string> = {
  running: "Running",
  done: "Done",
  failed: "Failed",
  stopped: "Stopped",
  dead: "Dead",
};

/** One word for the compact row. */
export function watcherStateLabel(watcher: Pick<Watcher, "state">): string {
  return STATE_LABELS[watcher.state];
}

/** Why a watcher failed or died, for its opened row; "" otherwise. */
export function watcherStateNote(watcher: Pick<Watcher, "state" | "exitCode">): string {
  if (watcher.state === "failed" && watcher.exitCode !== undefined) return `Exited with status ${watcher.exitCode}.`;
  if (watcher.state === "dead") return "The process is gone and recorded no exit status, for example after a restart.";
  return "";
}

const WATCHER_EVENT_MARKER = "[HUI watcher event]";

/** A settled watcher's event, as the chat shows it instead of the operator's bubble. `state` is absent only when the
 * marker's fields could not be read: still HUI's event, never the operator's words. */
export type WatcherEvent = {
  purpose: string;
  state?: WatcherState;
  note?: string;
  target?: string;
  outcome?: string;
  endedAt?: string;
};

/** Reads the event `server/agent-tools/watcher-events.ts` writes; undefined for anything else, the operator's own words
 * included. The event carries more (`last_output`, `log`, the action that follows); the chat shows the wait, not the
 * commands. */
export function parseWatcherEvent(text: string): WatcherEvent | undefined {
  if (text !== WATCHER_EVENT_MARKER && !text.startsWith(`${WATCHER_EVENT_MARKER}\n`)) return undefined;
  const fields = new Map<string, string>();
  for (const line of text.split("\n").slice(1)) {
    // The event's values are single lines; a blank one ends them, before its `Action:` instructions.
    if (!line) break;
    const match = /^([a-z_]+): ?(.*)$/u.exec(line);
    if (match) fields.set(match[1]!, match[2]!);
  }
  const state = fields.get("state") ?? "";
  const note = fields.get("note");
  const target = fields.get("target");
  const outcome = fields.get("outcome");
  const endedAt = fields.get("ended_at");
  return {
    purpose: fields.get("purpose") ?? "",
    ...(STATE_SET.has(state) ? { state: state as WatcherState } : {}),
    ...(note ? { note } : {}),
    ...(target ? { target } : {}),
    ...(outcome ? { outcome } : {}),
    ...(endedAt ? { endedAt } : {}),
  };
}
