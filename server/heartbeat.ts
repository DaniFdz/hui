/**
 * HUI's gateway heartbeat: a gateway-side check of the sessions a bot watches. It never prompts a watched session
 * itself. An idle or blocked watched session is reported to the session that watches it, and the chief decides the
 * next step; the heartbeat costs no turn in a bot's chat and cannot send a generic "continue". A session in Autonomous
 * mode is reported as one, so its chief reads the stop as its plan, a question or its report. Scans run one at a time,
 * so the 15-minute tick and the scan an Autonomous session's stop asks for never report one change twice. Also removes
 * the Heartbeat routines a previous build provisioned in bot chats.
 */
import type { AutomationService, AutomationTask } from "./automation.ts";
import type { SessionGoalStatus, SessionStatus } from "./api/sessions.ts";
import type { SessionRecord } from "./sessions/sessions.ts";
import type { WatcherState } from "./api/watchers.ts";

export const HEARTBEAT_INTERVAL_MS = 15 * 60_000;

/** The description on the routines a previous HUI build added to every chief; only those are removed. */
export const LEGACY_HEARTBEAT_DESCRIPTION = "HUI's check of the sessions this chief watches.";

export type HeartbeatDeps = {
  records(): Promise<readonly SessionRecord[]>;
  status(id: string): SessionStatus;
  watchers(id: string): readonly { state: WatcherState }[];
  /** Its subagents: one still at work wakes it when it reports, as a running watcher does. */
  subagents(id: string): readonly { status: string }[];
  /** The newest assistant message, for the chief to judge what the session last said. */
  lastAssistant(id: string): string | undefined;
  /** Deliver the status to the session that watches a target. The watcher decides; this never prompts the target. */
  notify(id: string, text: string): Promise<void>;
  now?(): number;
};

export type HeartbeatOutcome = { notified: string[] };

const DECISION = /\?\s*$|\b(should i|do you want|would you like|which|choose|decide|let me know|need (your|a)|waiting for|confirm|approve|shall i|your call|blocked|permission)\b/iu;

/** A conservative read of the newest reply: a question mark at the end or a decision phrase means the session is
 * waiting for someone, so the chief must judge it rather than send another task. */
export function looksLikeDecision(text: string | undefined): boolean {
  const last = text?.trim().split(/\n\s*\n/u).at(-1)?.trim() ?? "";
  return last.length > 0 && DECISION.test(last);
}

type HeartbeatState = "decision" | "waiting" | "error";

const WORKING = new Set(["queued", "starting", "running"]);

const watched = (autonomous: boolean, title: string) => `${autonomous ? "Autonomous" : "Watched"} session "${title}"`;

/** What a chief does with an Autonomous session's stop, said in the report so it holds without the pack's skills. */
const AUTONOMOUS_NOTE = "It runs in Autonomous mode and reports to you: accept or correct its plan, answer its question, or settle its report, with sessions_send. Escalate to the operator only what the decision skill reserves for them.";

const note = (autonomous: boolean) => autonomous ? [AUTONOMOUS_NOTE] : [];

function table(title: string, id: string, status: string): string[] {
  return [
    "| Session | Pull request | Status / blockers |",
    "| --- | --- | --- |",
    `| [${title}](/sessions/${id}?open=app) | — | ${status} |`,
  ];
}

function detail(last: string | undefined): string[] {
  return last?.trim() ? ["", last.trim().slice(0, 1_000)] : [];
}

function idleMessage(title: string, id: string, last: string | undefined, done: boolean, autonomous: boolean): string {
  return [
    `[routine: Heartbeat] ${watched(autonomous, title)} is ${done ? "done" : "idle"}; decide the next step.`,
    ...table(title, id, done ? "Done" : "Idle: needs the chief's decision"),
    ...detail(last),
    done
      ? "Read the final report and remove the watch when you have settled its ledger row. Nothing is waiting to continue."
      : "Read it with sessions_history. Send one specific followup with sessions_send, or remove the watch if nothing is left. Do not send a generic continue.",
    ...note(autonomous),
  ].join("\n");
}

function blockedMessage(title: string, id: string, state: HeartbeatState, last: string | undefined, autonomous: boolean): string {
  const status = state === "error" ? "Blocked: error" : state === "waiting" ? "Waiting on you: an answer" : "Waiting on you: a decision";
  return [
    `[routine: Heartbeat] ${watched(autonomous, title)} is ${state === "error" ? "in error" : state === "waiting" ? "waiting for an answer" : "idle and waiting for a decision"}.`,
    ...table(title, id, status),
    ...detail(last),
    "Read it with sessions_history; decide or escalate to the operator, then send the answer with sessions_send. Do not start unrelated work.",
    ...note(autonomous),
  ].join("\n");
}

/** A watched session is due when it is live, not archived, its goal is not paused/complete, and its status is idle,
 * waiting or error. Each state change is sent once; an idle session is a request for the chief's judgment, never a
 * command to continue, and one whose watcher or subagents still work is not due until they wake it. */
export function createHeartbeat(deps: HeartbeatDeps) {
  const notifiedAt = new Map<string, number>();
  let previousScan: Promise<unknown> = Promise.resolve();

  function scan(): Promise<HeartbeatOutcome> {
    const run = previousScan.then(scanOnce, scanOnce);
    previousScan = run.catch(() => undefined);
    return run;
  }

  async function scanOnce(): Promise<HeartbeatOutcome> {
    const records = await deps.records();
    const byId = new Map(records.map((record) => [record.id, record]));
    const watchedBy = new Map<string, string[]>();
    for (const watcher of records) {
      if (watcher.archived) continue;
      for (const id of watcher.watches ?? []) watchedBy.set(id, [...(watchedBy.get(id) ?? []), watcher.id]);
    }
    const notified: string[] = [];
    for (const [id, watcherIds] of watchedBy) {
      const target = byId.get(id);
      if (!target || target.archived || target.bot) continue;
      const status = deps.status(id);
      const at = deps.now?.() ?? Date.now();
      if (status !== "idle" && status !== "waiting" && status !== "error") continue;
      if (target.stage !== "done") {
        const goal: SessionGoalStatus | undefined = target.goal?.status;
        if (goal !== undefined && goal !== "active") continue;
      }
      if (status === "idle" && target.stage !== "done" && (
        deps.watchers(id).some((watcher) => watcher.state === "running") || deps.subagents(id).some((child) => WORKING.has(child.status))
      )) continue;
      const previous = notifiedAt.get(id);
      if (previous !== undefined && Date.parse(target.updatedAt) <= previous) continue;
      const last = deps.lastAssistant(id);
      const autonomous = target.autonomous === true;
      const message = target.stage === "done"
        ? idleMessage(target.title, id, last, true, autonomous)
        : status === "waiting" || status === "error"
          ? blockedMessage(target.title, id, status, last, autonomous)
          : looksLikeDecision(last)
            ? blockedMessage(target.title, id, "decision", last, autonomous)
            : idleMessage(target.title, id, last, false, autonomous);
      let sent = false;
      for (const watcherId of watcherIds) {
        try {
          await deps.notify(watcherId, message);
          sent = true;
        } catch {
          // A busy watcher is retried on the next scan.
        }
      }
      if (sent) {
        notifiedAt.set(id, at);
        notified.push(id);
      }
    }
    return { notified };
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
