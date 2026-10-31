import assert from "node:assert/strict";
import { test } from "vitest";

import { DEFAULT_SETTINGS, type Settings } from "../hui-settings.ts";
import { waitFor } from "../test-support/wait-for.ts";
import type { ProgressCard } from "../api/sessions.ts";
import type { TranscriptEntry } from "../runtimes/types.ts";
import { generateProgressCard, progressCardFromAnswer } from "./progress-card.ts";
import { SessionProgress, type ProgressSession } from "./session-progress.ts";

const settings = (utility = "fast/tiny"): Settings => ({ ...DEFAULT_SETTINGS, models: { ...DEFAULT_SETTINGS.models, utility } });
const transcript: TranscriptEntry[] = [
  { kind: "message", role: "user", text: "Fix the flaky deploy test." },
  { kind: "message", role: "assistant", text: "Found the timeout." },
];

test("reads the summary and plan a utility answer carries", () => {
  const answer = [
    "**Summary:** The deploy test still times out in CI.",
    "Plan:",
    "- done: Reproduce the failure",
    "- doing: Raise the wait to the real boot time",
    "- todo: Run the suite three times",
  ].join("\n");
  assert.deepEqual(progressCardFromAnswer(answer), {
    markdown: "The deploy test still times out in CI.",
    steps: [
      { step: "Reproduce the failure", status: "completed" },
      { step: "Raise the wait to the real boot time", status: "in_progress" },
      { step: "Run the suite three times", status: "pending" },
    ],
  });
  // A summary the model wrapped over two lines stays one note, and a step it
  // invented a state for is dropped rather than guessed.
  assert.deepEqual(progressCardFromAnswer("Summary: A\nnote here\n- blocked: Not a state\n- todo: Ship"), {
    markdown: "A note here",
    steps: [{ step: "Ship", status: "pending" }],
  });
  // A state is a word of its own: "nextish" and a bullet without a colon say nothing.
  assert.equal(progressCardFromAnswer("Plan:\n- nextish: Not a state\n- doingnothing: Also not"), undefined);
  assert.equal(progressCardFromAnswer("The work is going well."), undefined);
});

test("asks the utility model for the card and keeps nothing when it cannot answer", async () => {
  let model = "";
  let prompt = "";
  const answer = await generateProgressCard({
    cwd: "/tmp",
    settings: settings(),
    transcript,
    run: async (options) => {
      model = options.model;
      prompt = options.prompt;
      return "Summary: Looking at the timeout.\nPlan:\n- doing: Fix the test";
    },
  });
  assert.equal(model, "fast/tiny");
  assert.match(prompt, /Fix the flaky deploy test\./u, "the operator's request reaches the model");
  assert.deepEqual(answer?.steps, [{ step: "Fix the test", status: "in_progress" }]);

  assert.equal(await generateProgressCard({
    cwd: "/tmp", settings: settings(""), transcript, run: async () => assert.fail("no utility model, no call"),
  }), undefined);
  await assert.rejects(generateProgressCard({
    cwd: "/tmp",
    settings: settings(),
    transcript,
    run: async () => { throw new Error("provider down"); },
  }), /provider down/u, "a failed call is the caller's to report");
  assert.equal(await generateProgressCard({
    cwd: "/tmp",
    settings: settings(),
    transcript: [{ kind: "message", role: "assistant", text: "Hello" }],
    run: async () => assert.fail("nothing the operator asked, nothing to track"),
  }), undefined);
});

type Refresh = { id: string; card: ProgressCard };

function refresherFor(deps: {
  sessions?: Record<string, ProgressSession>;
  running?: readonly string[];
  run?: Parameters<typeof generateProgressCard>[0]["run"];
  intervalMs?: number;
} = {}) {
  const saved: Refresh[] = [];
  const refresher = new SessionProgress({
    settings: async () => settings(),
    session: async (id) => deps.sessions?.[id],
    transcript: () => transcript,
    running: () => deps.running ?? [],
    save: async (id, card) => { saved.push({ id, card }); },
    run: deps.run ?? (async () => "Summary: In progress.\nPlan:\n- doing: Fix the test"),
    ...(deps.intervalMs ? { intervalMs: deps.intervalMs } : {}),
  });
  return { refresher, saved };
}

test("a settled turn stores the card its conversation earned", async () => {
  const { refresher, saved } = refresherFor({ sessions: { a: { cwd: "/repo" } } });
  refresher.settled("a", transcript);
  await waitFor("the stored card", () => saved.length === 1);
  assert.deepEqual(saved[0], {
    id: "a",
    card: { markdown: "In progress.", steps: [{ step: "Fix the test", status: "in_progress" }] },
  });
});

test("a subagent session and a session that is gone get no card, and no model call", async () => {
  let calls = 0;
  const { refresher, saved } = refresherFor({
    sessions: { child: { cwd: "/repo", parentId: "parent" } },
    run: async () => { calls += 1; return "Summary: Child work.\nPlan:\n- doing: Read"; },
  });
  refresher.settled("child", transcript);
  refresher.settled("deleted", transcript);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(calls, 0);
  assert.deepEqual(saved, []);
});

test("a slow call collapses the turns waiting behind it into the newest transcript", async () => {
  const release: (() => void)[] = [];
  const prompts: string[] = [];
  const { refresher, saved } = refresherFor({
    sessions: { a: { cwd: "/repo" } },
    run: async (options) => {
      prompts.push(options.prompt);
      await new Promise<void>((resolve) => release.push(resolve));
      return "Summary: Busy.\nPlan:\n- doing: Fix the test";
    },
  });
  refresher.settled("a", [{ kind: "message", role: "user", text: "first ask" }]);
  await waitFor("the first call", () => prompts.length === 1);
  refresher.settled("a", [{ kind: "message", role: "user", text: "second ask" }]);
  refresher.settled("a", [{ kind: "message", role: "user", text: "third ask" }]);
  release[0]!();
  await waitFor("the collapsed call", () => prompts.length === 2);
  assert.match(prompts[1]!, /third ask/u, "the wait keeps the newest transcript only");
  assert.doesNotMatch(prompts[1]!, /second ask/u);
  release[1]!();
  await waitFor("both cards", () => saved.length === 2);
});

test("every running session is asked again while its turn goes", async () => {
  const { refresher, saved } = refresherFor({ sessions: { a: { cwd: "/repo" }, b: { cwd: "/repo" } }, running: ["a", "b"], intervalMs: 5 });
  refresher.start();
  await waitFor("the refreshed cards", () => saved.length >= 2);
  assert.deepEqual(saved.slice(0, 2).map(({ id }) => id), ["a", "b"]);
});
