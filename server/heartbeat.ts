/**
 * HUI's gateway heartbeat: a gateway-side check of the sessions a bot watches. It never prompts a watched session
 * itself. An idle or blocked watched session is reported to the session that watches it, and the chief decides the
 * next step; the scan itself costs no turn in a bot's chat and cannot send a generic "continue". A session a Chief of
 * Staff started stops for its chief only: `supervise` gives that chief the watch (`chiefToWatch`) and a scan runs at
 * once, saying the session is autonomous, so the chief reads its blocker or its report. The operator who switches it
 * back to Supervised takes back the watch the heartbeat gave. Scans run one at a time, so the 15-minute tick and the
 * run-end scan never report one change twice; a report also goes out only when the facts it depends on change (status,
 * stage, goal status and objective, the Autonomous flag and the last reply). Those fingerprints live in memory, so a
 * restart reports a live watched session once more. A report is never queued behind a turn in the watcher's chat: a busy
 * chat refuses it, nothing is queued, and the pair stays pending, so it is recomputed from the newest facts and
 * delivered when that chat's turn ends, with the 15-minute scan as the fallback. One watcher takes at most one report
 * per scan, so a chat whose turn settles at once is never told twice; the rest waits for its next run end, and a watcher
 * stays pending only while a report it is owed has not gone out. Also removes the Heartbeat routines a previous build
 * provisioned in bot chats.
 */
import { createHash } from "node:crypto";
import type { AutomationService, AutomationTask } from "./automation.ts";
import type { SessionGoalStatus, SessionStage, SessionStatus } from "./api/sessions.ts";
import type { SessionRecord } from "./sessions/sessions.ts";
import type { WatcherState } from "./api/watchers.ts";
import { chiefToWatch } from "./bots/chief-title.ts";
import { DEFAULT_SESSION_STAGE } from "./sessions/session-stages.ts";

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

/** The facts a report states, and nothing else: a title, a progress line or a goal's note changes no report. */
type ReportFacts = {
  status: SessionStatus;
  stage: SessionStage;
  goal: { status: SessionGoalStatus; objective: string } | null;
  autonomous: boolean;
  last: string;
};

/** One watcher and the target it was told about: the key `reported` remembers the report by. */
const watchedPair = (watcherId: string, id: string) => `${watcherId}\u0000${id}`;

/** A report's facts, hashed: the version keeps a later change of these facts from colliding with a report already
 * sent. */
function fingerprint(facts: ReportFacts): string {
  const { status, stage, goal, autonomous, last } = facts;
  return createHash("sha256").update(JSON.stringify({ v: 1, status, stage, goal, autonomous, last })).digest("hex");
}

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
 * goal never holds it back), and its status is idle, waiting or error. Each change of a report's facts is sent once,
 * per watcher; an idle session is a request for the chief's judgment, never a command to continue, and one whose
 * watcher or subagents still work is not due until they wake it, unless it asks something. */
export function createHeartbeat(deps: HeartbeatDeps) {
  // What each watcher was last told, in memory only: a restart reports a live watched session once more.
  const reported = new Map<string, string>();
  // Watchers a report is still owed to, because a busy chat refused it or a scan left the rest of its pairs for later:
  // a run end of that chat flushes it, a scan retries it, and a scan that finds nothing undelivered clears it.
  const pending = new Set<string>();
  let previousScan: Promise<unknown> = Promise.resolve();

  function scan(): Promise<HeartbeatOutcome> {
    const run = previousScan.then(() => scanOnce(), () => scanOnce());
    previousScan = run.catch(() => undefined);
    return run;
  }

  /** A watcher's chat finished a turn: flush the report it is owed, recomputed from the facts as they are now. A
   * watcher with nothing pending is left alone, so a run end on its own never reads the registry. Serialized on the
   * same chain as `scan`, so a tick and a flush never interleave. */
  function watcherIdle(watcherId: string): Promise<void> {
    if (!pending.has(watcherId)) return Promise.resolve();
    const run = previousScan.then(() => flush(watcherId), () => flush(watcherId));
    previousScan = run.catch(() => undefined);
    return run;
  }

  async function flush(watcherId: string): Promise<void> {
    // A scan queued ahead of this flush may have delivered the report already.
    if (!pending.has(watcherId)) return;
    await scanOnce(watcherId);
  }

  /** One scan; with `onlyWatcherId`, only that watcher's pairs, for a flush of what its chat is owed. */
  async function scanOnce(onlyWatcherId?: string): Promise<HeartbeatOutcome> {
    const records = await deps.records();
    const byId = new Map(records.map((record) => [record.id, record]));
    const watchedBy = new Map<string, string[]>();
    const watching = new Set<string>();
    for (const watcher of records) {
      if (watcher.archived) continue;
      for (const id of watcher.watches ?? []) {
        watchedBy.set(id, [...(watchedBy.get(id) ?? []), watcher.id]);
        watching.add(watcher.id);
      }
    }
    // A watch a scan saw removed and then put back reports once again; one whose target is archived or missing stays
    // remembered. A watcher whose watch list is gone stops being pending here too.
    const watchedPairs = new Set<string>();
    for (const [id, watcherIds] of watchedBy) {
      for (const watcherId of watcherIds) watchedPairs.add(watchedPair(watcherId, id));
    }
    for (const key of reported.keys()) if (!watchedPairs.has(key)) reported.delete(key);
    for (const watcherId of pending) if (!watching.has(watcherId)) pending.delete(watcherId);
    const notified: string[] = [];
    // The watchers this scan already gave a report to, and the ones a report is still owed to: a refusal, or a pair
    // left for later because its watcher was served already. Both stay pending until that report goes out.
    const handled = new Set<string>();
    const deferred = new Set<string>();
    for (const [id, watcherIds] of watchedBy) {
      const targets = onlyWatcherId === undefined ? watcherIds : watcherIds.filter((watcherId) => watcherId === onlyWatcherId);
      if (!targets.length) continue;
      const target = byId.get(id);
      if (!target || target.archived || target.bot || !deps.isLive(id)) continue;
      const status = deps.status(id);
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
      const message = target.stage === "done"
        ? idleMessage(target.title, id, last, true, autonomous)
        : status === "waiting" || status === "error"
          ? blockedMessage(target.title, id, status, last, autonomous)
          : looksLikeDecision(last)
            ? blockedMessage(target.title, id, "decision", last, autonomous)
            : idleMessage(target.title, id, last, false, autonomous);
      const facts = fingerprint({
        status,
        stage: target.stage ?? DEFAULT_SESSION_STAGE,
        goal: target.goal ? { status: target.goal.status, objective: target.goal.objective } : null,
        autonomous,
        last: last?.trim() ?? "",
      });
      let sent = false;
      for (const watcherId of targets) {
        const key = watchedPair(watcherId, id);
        if (reported.get(key) === facts) continue;
        // A watcher's chat takes one report per scan: whether it was just served, or its report was refused and nothing
        // more can land, every later pair waits. The skipped pair records no fingerprint, so the flush at that chat's
        // next run end sends it recomputed from the facts then.
        if (handled.has(watcherId)) {
          deferred.add(watcherId);
          pending.add(watcherId);
          continue;
        }
        // Pending from before this scan awaits the delivery, so a run end of that chat arriving while the scan waits on
        // it still chains a flush on this same scan, since a turn the delivery starts can end before `notify` resolves.
        // The reconciliation below clears it again unless this scan left the watcher owed a report.
        pending.add(watcherId);
        try {
          await deps.notify(watcherId, message);
          reported.set(key, facts);
          handled.add(watcherId);
          sent = true;
        } catch {
          // A busy watcher chat refuses the report instead of queueing it: no fingerprint is recorded, so the next scan
          // or the flush at its next run end recomputes it from the facts then.
          handled.add(watcherId);
          deferred.add(watcherId);
        }
      }
      if (sent) notified.push(id);
    }
    // Reconcile every watcher this scan looked at: it is pending only while a report it is owed did not go out here, so
    // a watcher whose undelivered pair is gone stops reading the registry at its chat's run ends.
    const considered = onlyWatcherId === undefined ? [...watching, ...pending] : [onlyWatcherId];
    for (const watcherId of considered) {
      if (!deferred.has(watcherId)) pending.delete(watcherId);
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

  return { scan, supervise, release, watcherIdle };
}

/** Removes only the routines HUI itself provisioned in #482; a routine with any other description is untouched. */
export async function removeLegacyHeartbeatRoutines(automation: Pick<AutomationService, "snapshot" | "remove">): Promise<string[]> {
  const tasks: readonly AutomationTask[] = (await automation.snapshot()).tasks;
  const legacy = tasks.filter((task) => task.name === "Heartbeat" && task.description === LEGACY_HEARTBEAT_DESCRIPTION);
  for (const task of legacy) await automation.remove(task.id);
  return legacy.map((task) => task.id);
}
