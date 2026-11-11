/**
 * Every Chief of Staff gets one HUI-owned Heartbeat routine, including the group chiefs a fresh gateway never
 * re-seeds: the routine checks the sessions that chief watches and continues one that stopped. It is provisioned at
 * gateway start, not left to the bot's first turn or to a per-bot pack update.
 */
import type { AutomationService, AutomationTask, AutomationTaskInput } from "../automation.ts";
import type { BotView } from "../api/bots.ts";
import { isChiefTitle } from "../bots/chief-title.ts";

export const HEARTBEAT_ROUTINE_NAME = "Heartbeat";
export const HEARTBEAT_INTERVAL_MS = 15 * 60_000;

/** The routine turn: no new work, only watched sessions whose own wait has ended. */
export const HEARTBEAT_PROMPT = [
  "Heartbeat. Do not start new work.",
  "1. Read work/index.md if it exists.",
  "2. Call watch_session list.",
  "3. Leave a watched session alone when it is archived, its goal is paused, it is running, or it has a watcher whose state is running. Its running watcher wakes it; do not race it.",
  "4. Continue an idle watched session only when its task is still open and either it has a watcher in dead or failed state, or it has no watcher at all. Send one message with sessions_send: \"Continue the task and report progress; do not start new work.\" If it already reported blocked three times, do not wake it; note it for the operator.",
  "5. Never create a session, spawn a child, restart a one-shot watcher, or begin a new task in a heartbeat.",
  "6. If you acted, add one line to work/index.md and reply with what you continued. Otherwise reply HEARTBEAT_OK and stop.",
].join("\n");

export type HeartbeatDeps = {
  bots: { list(options: { archived: "all" }): Promise<readonly BotView[]> };
  automation: Pick<AutomationService, "snapshot" | "create">;
};

export type HeartbeatOutcome = { created: string[]; existing: string[] };

/** Adds the routine to each live Chief of Staff that does not have one yet. A routine the operator or bot already
 * made with that name is left exactly as it is. */
export async function ensureChiefHeartbeats(deps: HeartbeatDeps): Promise<HeartbeatOutcome> {
  const existingTasks: readonly AutomationTask[] = (await deps.automation.snapshot()).tasks;
  const existing = new Set(existingTasks.filter((task) => task.name === HEARTBEAT_ROUTINE_NAME).map((task) => task.sessionId));
  const created: string[] = [];
  const already: string[] = [];
  for (const bot of await deps.bots.list({ archived: "all" })) {
    if (bot.archived || !isChiefTitle(bot.title) || !bot.sessionId) continue;
    if (existing.has(bot.sessionId)) {
      already.push(bot.id);
      continue;
    }
    const task: AutomationTaskInput = {
      name: HEARTBEAT_ROUTINE_NAME,
      description: "HUI's check of the sessions this chief watches.",
      sessionId: bot.sessionId,
      prompt: HEARTBEAT_PROMPT,
      schedule: { kind: "every", everyMs: HEARTBEAT_INTERVAL_MS },
      enabled: true,
    };
    await deps.automation.create(task);
    existing.add(bot.sessionId);
    created.push(bot.id);
  }
  return { created, existing: already };
}
