/** The goal's transitions, the agent's report, and the automatic turn HUI claims while a goal is active. */
import { describe, expect, it } from "vitest";

import type { SessionGoal } from "../api/sessions.ts";
import type { SessionRecord } from "./sessions.ts";
import {
  changeSessionGoal,
  claimGoalContinuation,
  goalPromptSection,
  GOAL_CONTINUE_PROMPT,
  MAX_GOAL_CONTINUATIONS,
  updateGoalFromAgent,
} from "./goals.ts";

const NOW = new Date("2026-10-28T10:00:00.000Z");
const AT = NOW.toISOString();

function goal(patch: Partial<SessionGoal> = {}): SessionGoal {
  return { objective: "ship it", status: "active", createdAt: AT, updatedAt: AT, continuations: 0, ...patch };
}

/** A registry of one record, mutated in place like `updateRegistry` mutates the file. */
function registry(initial?: SessionGoal) {
  const state = {
    record: {
      id: "s1", title: "Session", group: "", cwd: "/tmp", tool: "durable", createdAt: AT, updatedAt: AT,
      ...(initial ? { goal: initial } : {}),
    } as SessionRecord,
  };
  const updater = async (mutate: (records: readonly SessionRecord[]) => readonly SessionRecord[]) => {
    state.record = mutate([state.record])[0] ?? state.record;
    return [state.record];
  };
  return { state, updater };
}

describe("goals", () => {
  it("starts with the trimmed objective and no automatic turns", async () => {
    const { state, updater } = registry();
    await changeSessionGoal("s1", { action: "start", objective: "  get CI green  " }, NOW, updater);
    expect(state.record.goal).toEqual({ objective: "get CI green", status: "active", createdAt: AT, updatedAt: AT, continuations: 0 });
  });

  it("pauses an active goal, resumes a paused one, and clears it", async () => {
    const { state, updater } = registry(goal());
    await changeSessionGoal("s1", { action: "pause" }, NOW, updater);
    expect(state.record.goal?.status).toBe("paused");
    await expect(changeSessionGoal("s1", { action: "pause" }, NOW, updater)).rejects.toThrow("Only an active goal can be paused.");
    await changeSessionGoal("s1", { action: "resume" }, NOW, updater);
    expect(state.record.goal?.status).toBe("active");
    await changeSessionGoal("s1", { action: "clear" }, NOW, updater);
    expect(state.record.goal).toBeUndefined();
    await expect(changeSessionGoal("s1", { action: "resume" }, NOW, updater)).rejects.toThrow("This conversation has no goal.");
  });

  it("lets the agent report complete or blocked, keeps its note, and refuses a second report", async () => {
    const { state, updater } = registry(goal());
    const blocked = await updateGoalFromAgent("s1", { status: "blocked", note: " waiting on review " }, NOW, updater);
    expect(blocked.status).toBe("updated");
    expect(state.record.goal).toMatchObject({ status: "blocked", note: "waiting on review" });

    const done = await updateGoalFromAgent("s1", { status: "complete" }, NOW, updater);
    expect(done.status).toBe("error");
    expect(done.error).toContain("already blocked");

    const fresh = registry();
    const nothing = await updateGoalFromAgent("s1", { status: "complete" }, NOW, fresh.updater);
    expect(nothing).toMatchObject({ status: "error", error: "This conversation has no goal." });
  });

  it("claims one automatic turn at a time and pauses at the cap", async () => {
    const { state, updater } = registry(goal({ continuations: 5 }));
    expect(await claimGoalContinuation("s1", NOW, updater, async () => [state.record])).toBe(GOAL_CONTINUE_PROMPT);
    expect(state.record.goal?.continuations).toBe(6);

    state.record = { ...state.record, goal: goal({ continuations: MAX_GOAL_CONTINUATIONS }) };
    expect(await claimGoalContinuation("s1", NOW, updater, async () => [state.record])).toBeUndefined();
    expect(state.record.goal?.status).toBe("paused");
    expect(state.record.goal?.note).toContain("automatic turns");

    state.record = { ...state.record, goal: goal({ status: "complete" }) };
    expect(await claimGoalContinuation("s1", NOW, updater, async () => [state.record])).toBeUndefined();
    expect(state.record.goal).toMatchObject({ status: "complete", continuations: 0 });
  });

  it("carries the objective into the prompt only while the goal is active", () => {
    expect(goalPromptSection(goal({ objective: "get CI green on PR 12345" }))).toContain("get CI green on PR 12345");
    expect(goalPromptSection(goal({ status: "paused" }))).toBeUndefined();
    expect(goalPromptSection(undefined)).toBeUndefined();
  });
});