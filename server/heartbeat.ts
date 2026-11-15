/**
 * HUI's gateway heartbeat: a gateway-side check of the sessions a bot watches. It never prompts a watched session
 * itself. An idle or blocked watched session is reported to the session that watches it, and the chief decides the
 * next step; the scan itself costs no turn in a bot's chat and cannot send a generic "continue". A session a Chief of
 * Staff started stops for its chief only: `supervise` gives that chief the watch (`chiefToWatch`) and a scan runs at
 * once, saying the session is autonomous, so the chief reads its blocker or its report. The operator who switches it
 * back to Supervised takes back the watch the heartbeat gave. Scans run one at a time, so the 15-minute tick and that
 * scan never report one change twice. Also removes the Heartbeat routines a previous build provisioned in bot chats.
 */
import type { AutomationService, AutomationTask } from "./automation.ts";
import type { SessionGoalStatus, SessionStatus } from "./api/sessions.ts";
import type { SessionRecord } from "./sessions/sessions.ts";
import type { WatcherState } from "./api/watchers.ts";
import { chiefToWatch } from "./bots/chief-title.ts";

export const HEARTBEAT_INTERVAL_MS = 15 * 60_000;

/** The description on the routines a previous HUI build added to every chief; only those are removed. */
export const LEGACY_HEARTBEAT_DESCRIPTION = "HUI's check of the sessions this chief watches.";

export type HeartbeatDeps = {
  records(): Promise<readonly SessionRecord[]>;
  status(id: string): SessionStatus;
  /** Whether it is open in this gateway: a session nobody opened since the gateway started has not changed since. */
  isLive(id: string): boolean;
  watchers(id: string): readonly { state: WatcherState }[];
  /** Its subagents: one still at work wakes it when it reports, as a running watcher does. */
  subagents(id: string): readonly { status: string }[];
  /** The newest assistant message, for the chief to judge what the session last said. */
  lastAssistant(id: string): string | undefined;
  /** Deliver the status to the session that watches a target. The watcher decides; this never prompts the target. */
  notify(id: string, text: string): Promise<void>;
  /** The bots, among which an Autonomous session's chief is chosen. */
  bots(): Promise<readonly { title?: string; group?: string; archived?: boolean; sessionId: string }[]>;
  /** Adds `id` to the watches of the session `watcherId` (`on`), or takes it off them. */
  watch(watcherId: string, id: string, on: boolean): Promise<void>;
  /** How many sessions one session may watch. */
  watchLimit: number;
  now?(): number;
};

export type HeartbeatOutcome = { notified: string[] };

const DECISION = /\?\s*$|\b(should i|do you want|would you like|which|choose|decide|let me know|need (your|a)|waiting for|confirm|approve|shall i|your call|blocked|permission)\b/iu;

const lastParagraph = (text: string | undefined) => text?.trim().split(/\n\s*\n/u).at(-1)?.trim() ?? "";

/** A conservative read of the newest reply: a question mark at the end or a decision phrase means the session is
 * waiting for someone, so the chief must judge it rather than send another task. */
export function looksLikeDecision(text: string | undefined): boolean {
  const last = lastParagraph(text);
  return last.length > 0 && DECISION.test(last);
}

/** Whether the newest reply ends on a question: only that brings a session forward while its subagents still work,
 * since a status such as "waiting for the verifier" reads like a decision. */
const asks = (text: string | undefined) => /\?\s*$/u.test(lastParagraph(text));

type HeartbeatState = "decision" | "waiting" | "error";

const WORKING = new Set(["queued", "starting", "running"]);

const watched = (autonomous: boolean, title: string) => `${autonomous ? "Autonomous" : "Watched"} session "${title}"`;

/** What a chief does with an Autonomous session's stop, said in the report so it holds without the pack's skills. */
const AUTONOMOUS_NOTE = "It runs Autonomous and reports to you: approve or correct its plan, clear its blocker or settle its report with sessions_send and timeoutSeconds 0, since its next stop comes back to you. Escalate to the operator only what the decision skill reserves for them.";

const note = (autonomous: boolean) => autonomous ? [AUTONOMOUS_NOTE] : [];

function table(title: string, id: string, status: string): string[] {
  return [
    "| Session | Pull request | Status / blockers |",
    "| --- | --- | --- |",
    `| [${title}](/sessions/${id}?open=app) | — | ${status} |`,
  ];
}

/** The reply, its start and its end when it is long, so a long plan keeps the question it ends on. */
function detail(last: string | undefined): string[] {
  const text = last?.trim() ?? "";
  if (!text) return [];
  return ["", text.length <= 1_000 ? text : `${text.slice(0, 600)}\n…\n${text.slice(-400)}`];
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
    ...state === "waiting"
      ? ["Read it with sessions_history. A question card in the session is answered only there: ask the operator to answer it. Do not start unrelated work."]
      : ["Read it with sessions_history; decide or escalate to the operator, then send the answer with sessions_send. Do not start unrelated work.", ...note(autonomous)],
  ].join("\n");
}

/** A watched session is due when it is live, not archived, its goal is not paused/complete (an Autonomous session's
 * goal never holds it back), and its status is idle, waiting or error. Each state change is sent once; an idle session
 * is a request for the chief's judgment, never a command to continue, and one whose watcher or subagents still work is
 * not due until they wake it, unless it asks something. */
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
      if (!target || target.archived || target.bot || !deps.isLive(id)) continue;
      const status = deps.status(id);
      const at = deps.now?.() ?? Date.now();
      if (status !== "idle" && status !== "waiting" && status !== "error") continue;
      const autonomous = target.autonomous === true;
      if (target.stage !== "done" && !autonomous) {
        const goal: SessionGoalStatus | undefined = target.goal?.status;
        if (goal !== undefined && goal !== "active") continue;
      }
      const last = deps.lastAssistant(id);
      if (status === "idle" && target.stage !== "done" && !asks(last) && (
        deps.watchers(id).some((watcher) => watcher.state === "running") || deps.subagents(id).some((child) => WORKING.has(child.status))
      )) continue;
      const previous = notifiedAt.get(id);
      if (previous !== undefined && Date.parse(target.updatedAt) <= previous) continue;
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

  /** The chief's chat each Autonomous session was given by `supervise`, the only watch `release` takes back. */
  const given = new Map<string, string>();
  let previousChange: Promise<unknown> = Promise.resolve();
  /** Supervision and release run one at a time, so Supervised right after a stop takes back the watch that stop gave. */
  function inTurn<T>(change: () => Promise<T>): Promise<T> {
    const run = previousChange.then(change, change);
    previousChange = run.catch(() => undefined);
    return run;
  }

    /** A session a Chief of Staff started that stops: the chief `chiefToWatch` picks starts watching it, and a scan runs
   * at once. Answers false when that chief's watch list is full, so the stop reaches no chief. */
  async function supervise(id: string): Promise<boolean> {
    const full = await inTurn(async () => {
      const records = await deps.records();
      const session = records.find((record) => record.id === id);
      // A session the operator started reports in its own chat, so no chief is given it.
      const chief = session?.autonomous && session.lead ? chiefToWatch(await deps.bots(), records, session) : undefined;
      const atLimit = chief !== undefined && (records.find((record) => record.id === chief.sessionId)?.watches?.length ?? 0) >= deps.watchLimit;
      if (chief && !atLimit) {
        await deps.watch(chief.sessionId, id, true);
        given.set(id, chief.sessionId);
      }
      return atLimit;
    });
    await scan();
    return !full;
  }

  /** An Autonomous session the operator took back leaves the watch `supervise` gave it; a chief's own watch stays. */
  function release(id: string): Promise<void> {
    return inTurn(async () => {
      const chat = given.get(id);
      if (!chat) return;
      await deps.watch(chat, id, false);
      given.delete(id);
    });
  }

  return { scan, supervise, release };
}

/** Removes only the routines HUI itself provisioned in #482; a routine with any other description is untouched. */
export async function removeLegacyHeartbeatRoutines(automation: Pick<AutomationService, "snapshot" | "remove">): Promise<string[]> {
  const tasks: readonly AutomationTask[] = (await automation.snapshot()).tasks;
  const legacy = tasks.filter((task) => task.name === "Heartbeat" && task.description === LEGACY_HEARTBEAT_DESCRIPTION);
  for (const task of legacy) await automation.remove(task.id);
  return legacy.map((task) => task.id);
}
