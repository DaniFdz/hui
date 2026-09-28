/** Pure helpers for presenting spawned-subagent progress. */

export type SubagentTiming = {
  status: string;
  startedAt: string;
  endedAt?: string;
  updatedAt?: string;
};

const ACTIVE = new Set(["starting", "running"]);

export function isSubagentActive(status: string): boolean {
  return ACTIVE.has(status);
}

/** Formats a duration like OpenClaw's session list: `6s`, `34m 25s`, `1h 2m`. */
export function formatElapsed(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0s";
  const total = Math.floor(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
  if (minutes > 0) return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
  return `${seconds}s`;
}

/** Elapsed time from start to end (or `now` while active); undefined when unknown. */
export function subagentElapsed(task: SubagentTiming, now = Date.now()): string | undefined {
  const start = Date.parse(task.startedAt);
  if (!Number.isFinite(start)) return undefined;
  const endSource = isSubagentActive(task.status) ? undefined : task.endedAt ?? task.updatedAt;
  const end = endSource ? Date.parse(endSource) : now;
  if (!Number.isFinite(end)) return undefined;
  return formatElapsed(end - start);
}

export type SubagentVisualState = "running" | "completed" | "failed" | "cancelled";

export function subagentVisualState(status: string): SubagentVisualState {
  if (isSubagentActive(status)) return "running";
  if (status === "completed") return "completed";
  if (status === "cancelled") return "cancelled";
  return "failed";
}
