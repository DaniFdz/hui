/**
 * The goal a conversation pursues: the objective the operator gave it, the status only they can pause, resume or
 * clear, the agent's report that it is done or blocked, and the automatic turn HUI queues while a goal is active.
 * The record lives in the session registry (`sessions.ts`), so it survives restarts and reaches the prompt the same
 * way the Kanban stage does. Goals belong to sessions this gateway runs: a worker's session keeps its own registry.
 */
import type { SessionGoal, SessionGoalStatus } from "../api/sessions.ts";
import { recordDiagnosticEvent } from "../observability.ts";
import { readRegistry, updateRegistry, SessionNotFoundError, type SessionRecord } from "./sessions.ts";

const GOAL_OBJECTIVE_MAX = 2_000;
const GOAL_NOTE_MAX = 2_000;
/** Automatic turns one goal may spend before HUI pauses it. The operator resumes it for another window. */
export const MAX_GOAL_CONTINUATIONS = 10;
/** What HUI queues to pursue an active goal, in the operator's place. */
export const GOAL_CONTINUE_PROMPT = "Continue the goal.";

/** Statuses the agent may report; pausing, resuming and clearing stay operator actions. */
const AGENT_GOAL_STATUSES = ["complete", "blocked"] as const;

export class GoalError extends Error {}

export function startGoal(objective: string, now = new Date()): SessionGoal {
  const trimmed = objective.trim();
  if (!trimmed) throw new GoalError("A goal needs an objective.");
  if (trimmed.length > GOAL_OBJECTIVE_MAX) throw new GoalError(`A goal objective is at most ${GOAL_OBJECTIVE_MAX} characters.`);
  const at = now.toISOString();
  return { objective: trimmed, status: "active", createdAt: at, updatedAt: at, continuations: 0 };
}

/** A goal that exists is reported with its status, so the operator can see why an action was refused. */
function requireGoal(record: SessionRecord | undefined): SessionGoal {
  if (!record) throw new SessionNotFoundError("Conversation no longer exists.");
  if (!record.goal) throw new GoalError("This conversation has no goal.");
  return record.goal;
}

function transition(goal: SessionGoal, status: SessionGoalStatus, now: Date, note?: string): SessionGoal {
  const trimmed = note?.trim().slice(0, GOAL_NOTE_MAX);
  return {
    ...goal,
    status,
    updatedAt: now.toISOString(),
    ...(status === "active" ? { note: undefined } : trimmed ? { note: trimmed } : {}),
  };
}

/** The line every turn of an active goal carries, or nothing when there is no goal to pursue. */
export function goalPromptSection(goal: SessionGoal | undefined): string | undefined {
  if (goal?.status !== "active") return undefined;
  return [
    "## Active goal",
    goal.objective,
    "",
    "Pursue it across turns until it is fully achieved; do not stop to ask whether to continue. Mark it complete with",
    "`update_goal` only when the whole objective is verified and no required work remains. Mark it blocked only when",
    "the same blocker has held for three consecutive turns. After `update_goal`, still give the operator their reply.",
  ].join("\n");
}

export type GoalChange = {
  /** The goal after the change; undefined when it was cleared. */
  goal: SessionGoal | undefined;
  /** An objective whose first turn still has to be sent, and whether resuming needs the same push. */
  start?: string;
  resumed?: boolean;
};

/** The operator's actions on a goal, from the goal route and the `/goal` command. */
export async function changeSessionGoal(
  id: string,
  body: Record<string, unknown>,
  now = new Date(),
  registryUpdater: typeof updateRegistry = updateRegistry,
): Promise<GoalChange> {
  const action = body["action"];
  const objective = typeof body["objective"] === "string" ? body["objective"] : "";
  let change: GoalChange | undefined;
  await registryUpdater((records) => {
    const record = records.find((each) => each.id === id);
    if (!record) throw new SessionNotFoundError("Conversation no longer exists.");
    if (action === "clear") {
      change = { goal: undefined };
      return records.map((each) => (each.id === id ? { ...each, goal: undefined } : each));
    }
    if (action === "start") {
      const next = startGoal(objective, now);
      change = { goal: next, start: next.objective };
      return records.map((each) => (each.id === id ? { ...each, goal: next } : each));
    }
    const goal = requireGoal(record);
    if (action === "pause") {
      if (goal.status !== "active") throw new GoalError("Only an active goal can be paused.");
      const next = transition(goal, "paused", now);
      change = { goal: next };
      return records.map((each) => (each.id === id ? { ...each, goal: next } : each));
    }
    if (action === "resume") {
      if (goal.status !== "paused" && goal.status !== "blocked") throw new GoalError("Only a paused or blocked goal can be resumed.");
      const next = transition(goal, "active", now);
      change = { goal: next, resumed: true };
      return records.map((each) => (each.id === id ? { ...each, goal: next } : each));
    }
    throw new GoalError("Unknown goal action.");
  });
  if (!change) throw new SessionNotFoundError("Conversation no longer exists.");
  return change;
}

export type AgentGoalResult = {
  status: "updated" | "error";
  goal?: SessionGoal;
  error?: string;
  nextAction: string;
};

const RETRY_REFUSAL = "Do not retry update_goal. Continue this turn and give the operator your reply.";

/** The agent's report from `update_goal`. It cannot pause, resume, clear or replace a goal. */
export async function updateGoalFromAgent(
  id: string,
  params: Record<string, unknown>,
  now = new Date(),
  registryUpdater: typeof updateRegistry = updateRegistry,
): Promise<AgentGoalResult> {
  const requested = params["status"];
  const status = AGENT_GOAL_STATUSES.find((candidate) => candidate === requested);
  if (!status) {
    return { status: "error", error: `status must be one of ${AGENT_GOAL_STATUSES.join(", ")}.`, nextAction: RETRY_REFUSAL };
  }
  const note = typeof params["note"] === "string" ? params["note"] : undefined;
  let updated: SessionGoal | undefined;
  let refusal: string | undefined;
  await registryUpdater((records) => {
    const record = records.find((each) => each.id === id);
    if (!record?.goal) {
      refusal = "This conversation has no goal.";
      return records;
    }
    if (record.goal.status !== "active") {
      refusal = `The goal is already ${record.goal.status}.`;
      return records;
    }
    updated = transition(record.goal, status, now, note);
    return records.map((each) => (each.id === id ? { ...each, goal: updated } : each));
  });
  if (!updated) return { status: "error", error: refusal ?? "Conversation no longer exists.", nextAction: RETRY_REFUSAL };
  return {
    status: "updated",
    goal: updated,
    nextAction: "No reply was sent to the operator. Continue this turn and give them the reply they asked for.",
  };
}

/**
 * Claims one automatic turn for the conversation's active goal. Returns the prompt to queue, or nothing when no turn
 * should run: no goal, a paused, blocked or complete one, or the cap that pauses it instead.
 */
export async function claimGoalContinuation(
  id: string,
  now = new Date(),
  registryUpdater: typeof updateRegistry = updateRegistry,
  reader: () => Promise<readonly SessionRecord[]> = readRegistry,
): Promise<string | undefined> {
  // The registry is rewritten for every mutation, so a conversation without an active goal must not reach one.
  if ((await reader()).find((each) => each.id === id)?.goal?.status !== "active") return undefined;
  let prompt: string | undefined;
  await registryUpdater((records) => records.map((record) => {
    if (record.id !== id || record.goal?.status !== "active") return record;
    if (record.goal.continuations >= MAX_GOAL_CONTINUATIONS) {
      const paused = transition(record.goal, "paused", now, `Paused after ${record.goal.continuations} automatic turns. Resume to keep going.`);
      recordDiagnosticEvent({
        area: "session", level: "info", action: "goal_continuation_capped",
        summary: `Goal paused after ${record.goal.continuations} automatic turns`, sessionId: id,
      });
      return { ...record, goal: paused };
    }
    prompt = GOAL_CONTINUE_PROMPT;
    return { ...record, goal: { ...record.goal, continuations: record.goal.continuations + 1, updatedAt: now.toISOString() } };
  }));
  return prompt;
}

/** The goal a conversation's next prompt should carry, read fresh so a pause holds at the next turn. */
export async function sessionGoalSection(id: string): Promise<string | undefined> {
  const record = (await readRegistry()).find((each) => each.id === id);
  return goalPromptSection(record?.goal);
}