/**
 * HUI's heartbeat: a gateway-side check of the sessions a bot watches. It prompts an idle watched session to
 * continue when its watcher is not running, so the check costs no bot turn and never enters a bot's conversation
 * context. Also removes the Heartbeat routines a previous build provisioned in bot chats.
 */
import type { AutomationService, AutomationTask } from "./automation.ts";
import type { SessionGoalStatus, SessionStatus } from "./api/sessions.ts";
import type { SessionRecord } from "./sessions/sessions.ts";
import type { WatcherState } from "./api/watchers.ts";

export const HEARTBEAT_INTERVAL_MS = 15 * 60_000;
export const HEARTBEAT_PROMPT = "Continue the task and report progress; do not start new work.";

/** The description on the routines a previous HUI build added to every chief; only those are removed. */
export const LEGACY_HEARTBEAT_DESCRIPTION = "HUI's check of the sessions this chief watches.";

export type HeartbeatDeps = {
  records(): Promise<readonly SessionRecord[]>;
  status(id: string): SessionStatus;
  watchers(id: string): readonly { state: WatcherState }[];
  prompt(id: string, text: string): Promise<void>;
  now?(): number;
};

export type HeartbeatOutcome = { continued: string[] };

/** A watched session is due when it is live, not archived, its goal is not paused/complete, it is idle, and no
 * watcher is running. Each idle span is prompted once: a later status update makes it due again. */
export function createHeartbeat(deps: HeartbeatDeps) {
  const promptedAt = new Map<string, number>();

  async function scan(): Promise<HeartbeatOutcome> {
    const records = await deps.records();
    const byId = new Map(records.map((record) => [record.id, record]));
    const seen = new Set<string>();
    const continued: string[] = [];
    for (const watcher of records) {
      if (watcher.archived) continue;
      for (const id of watcher.watches ?? []) {
        if (seen.has(id)) continue;
        seen.add(id);
        const target = byId.get(id);
        if (!target || target.archived || target.bot || target.stage === "done") continue;
        const goal: SessionGoalStatus | undefined = target.goal?.status;
        if (goal !== undefined && goal !== "active") continue;
        if (deps.status(id) !== "idle") continue;
        if (deps.watchers(id).some((watcher) => watcher.state === "running")) continue;
        const at = deps.now?.() ?? Date.now();
        const previous = promptedAt.get(id);
        if (previous !== undefined && Date.parse(target.updatedAt) <= previous) continue;
        try {
          await deps.prompt(id, HEARTBEAT_PROMPT);
          promptedAt.set(id, at);
          continued.push(id);
        } catch {
          // A session that went busy between the status read and the prompt is retried on the next scan.
        }
      }
    }
    return { continued };
  }

  return { scan };
}

/** Removes only the routines HUI itself provisioned in #482; a routine with any other description is untouched. */
export async function removeLegacyHeartbeatRoutines(automation: Pick<AutomationService, "snapshot" | "remove">): Promise<string[]> {
  const tasks: readonly AutomationTask[] = (await automation.snapshot()).tasks;
  const legacy = tasks.filter((task) => task.name === "Heartbeat" && task.description === LEGACY_HEARTBEAT_DESCRIPTION);
  for (const task of legacy) await automation.remove(task.id);
  return legacy.map((task) => task.id);
}
