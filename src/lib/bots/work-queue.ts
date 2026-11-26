/**
 * A bot's own work, from the sessions its chat started: which lane each session sits in (Needs you, Working or
 * Recent), the queue the bot panel draws, and the counts the Bots tab badge reads. Read-time only: a lane comes from
 * the session's live status, never from a stored field, so nothing here writes or backfills the registry.
 */
import type { SessionView } from "../../api/sessions.ts";

export type WorkLane = "needs-you" | "working" | "recent";

/** The lanes, nearest first: what needs the operator, what is being worked on, then what finished. */
export const WORK_LANES: readonly WorkLane[] = ["needs-you", "working", "recent"];

export const WORK_LANE_LABELS: Readonly<Record<WorkLane, string>> = { "needs-you": "Needs you", working: "Working", recent: "Recent" };

/** How many rows the panel's Work queue draws before Show more. */
export const WORK_QUEUE_CAP = 8;

export type WorkLaneCounts = Readonly<Record<WorkLane, number>>;

export type WorkRow = { lane: WorkLane; session: SessionView };

export type WorkQueue = {
  /** Every session the bot started, one lane each: lane order, newest first inside a lane. */
  rows: readonly WorkRow[];
  counts: WorkLaneCounts;
  /** The sessions that need the operator or are still being worked on; Recent never counts. */
  inFlight: number;
};

/** An empty queue, for a bot that started nothing and for a roster that draws no work. */
export const EMPTY_WORK_QUEUE: WorkQueue = { rows: [], counts: { "needs-you": 0, working: 0, recent: 0 }, inFlight: 0 };

const LANE_ORDER: Readonly<Record<WorkLane, number>> = { "needs-you": 0, working: 1, recent: 2 };

/**
 * A session's lane, read from its status (never its stage): a question waiting, an error or a lost machine, and a run
 * that failed and left the session idle all need the operator; a turn that is starting, running or reconnecting is
 * work; everything else, a failed worktree creation included, is history.
 */
export function workLane(session: Pick<SessionView, "status" | "runFailed">): WorkLane {
  if (session.status === "waiting" || session.status === "error" || session.status === "disconnected") return "needs-you";
  if (session.status === "idle" && session.runFailed) return "needs-you";
  if (session.status === "running" || session.status === "starting" || session.status === "reconnecting") return "working";
  return "recent";
}

/** The bot's queue: one lane per session, lane order, newest first inside a lane, the id breaking ties so two redraws
 * of the same registry never reorder. */
export function botWorkQueue(sessions: readonly SessionView[]): WorkQueue {
  const rows = sessions
    .map((session) => ({ lane: workLane(session), session }))
    .sort((a, b) => LANE_ORDER[a.lane] - LANE_ORDER[b.lane]
      || b.session.updatedAt.localeCompare(a.session.updatedAt)
      || a.session.id.localeCompare(b.session.id));
  const counts: Record<WorkLane, number> = { "needs-you": 0, working: 0, recent: 0 };
  for (const row of rows) counts[row.lane] += 1;
  return { rows: rows.map(({ lane, session }) => ({ lane, session })), counts, inFlight: counts["needs-you"] + counts.working };
}

/** One queue per bot id, from the membership index the sidebar already builds (`startedSessionsByBot`): a registry
 * projection is walked once for the roster and the panel together, never once per bot. */
export function botWorkQueues(started: ReadonlyMap<string, readonly SessionView[]>): ReadonlyMap<string, WorkQueue> {
  const queues = new Map<string, WorkQueue>();
  for (const [botId, sessions] of started) if (sessions.length) queues.set(botId, botWorkQueue(sessions));
  return queues;
}

/** The rows the panel draws (the first `WORK_QUEUE_CAP` until the operator shows the rest), and how many wait. */
export function workQueueRows(queue: WorkQueue, expanded: boolean): { rows: readonly WorkRow[]; more: number } {
  return { rows: expanded ? queue.rows : queue.rows.slice(0, WORK_QUEUE_CAP), more: Math.max(0, queue.rows.length - WORK_QUEUE_CAP) };
}

/** The rows by lane, in lane order, each group with the label it draws; a lane with no row draws nothing. */
export function workLanes(rows: readonly WorkRow[]): { lane: WorkLane; label: string; rows: readonly WorkRow[] }[] {
  const lanes: { lane: WorkLane; label: string; rows: WorkRow[] }[] = [];
  for (const row of rows) {
    const group = lanes.at(-1);
    if (group?.lane === row.lane) group.rows.push(row);
    else lanes.push({ lane: row.lane, label: WORK_LANE_LABELS[row.lane], rows: [row] });
  }
  return lanes;
}

/** "1 needs you · 1 working · 7 recent": a lane with nothing is left out, and no lane at all is no headline. */
export function workQueueHeadline(counts: WorkLaneCounts): string {
  return WORK_LANES
    .filter((lane) => counts[lane] > 0)
    .map((lane) => `${counts[lane]} ${lane === "needs-you" ? "needs you" : lane}`)
    .join(" · ");
}

/** The roster's badge and accessible name: "1 session in flight", "2 sessions in flight". */
export function sessionsInFlight(count: number): string {
  return `${count} ${count === 1 ? "session" : "sessions"} in flight`;
}
