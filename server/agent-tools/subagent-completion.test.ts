import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";

import {
  CONTINUE_PROMPT,
  SUBAGENT_COMPLETION_MARKER,
  SUBAGENT_NO_REPLY,
  classifySubagentEnd,
  formatSubagentCompletionEvent,
  reportedSubagentEnd,
} from "./subagent-completion.ts";
import type { TranscriptEntry } from "../runtimes/types.ts";

const fixture: { continuePrompt: string; marker: string; cases: { input: Parameters<typeof formatSubagentCompletionEvent>[0]; expected: string }[] } = JSON.parse(readFileSync(new URL("./subagent-completion.fixture.json", import.meta.url), "utf8"));

const QUOTA = "400 You exceeded your current quota. Please check your plan and billing details.";
const question: TranscriptEntry = { kind: "message", role: "user", text: "[Subagent Task]\nInspect the implementation" };
const answer = (text: string): TranscriptEntry => ({ kind: "message", role: "assistant", text });
const failure = (message: string): TranscriptEntry => ({ kind: "error", message });

test("completion events preserve their prompts, framing and escaped results", () => {
  assert.equal(CONTINUE_PROMPT, fixture.continuePrompt);
  assert.equal(SUBAGENT_COMPLETION_MARKER, fixture.marker);
  for (const item of fixture.cases) assert.equal(formatSubagentCompletionEvent(item.input), item.expected);
});

test("a run that reported an error and left no answer failed with that error", () => {
  assert.deepEqual(classifySubagentEnd([question, failure(QUOTA)]), { status: "failed", error: QUOTA });
});

test("an error after a partial answer failed with the error, whatever the child said first", () => {
  assert.deepEqual(
    classifySubagentEnd([question, answer("I will start by reading"), failure(QUOTA)]),
    { status: "failed", error: QUOTA },
  );
});

test("a run that answered after its error completed with the answer", () => {
  assert.deepEqual(
    classifySubagentEnd([question, failure(QUOTA), answer("Recovered answer")]),
    { status: "completed", summary: "Recovered answer" },
  );
});

test("a run that ended with no answer and no error failed without a reply", () => {
  assert.deepEqual(classifySubagentEnd([question]), { status: "failed", error: SUBAGENT_NO_REPLY });
  assert.equal(SUBAGENT_NO_REPLY, "The subagent finished without a reply.");
});

test("an answer followed by a runtime error failed with that error", () => {
  // Durable's shape: settling refreshed the history and dropped the error entry.
  assert.deepEqual(
    classifySubagentEnd([question, answer("Partial answer")], QUOTA),
    { status: "failed", error: QUOTA },
  );
});

test("a runtime error with no answer after it outranks an answer the entries already held", () => {
  // The watcher keeps runtimeError only until assistant text streams again, so a captured error is newer than
  // every entry: an answer it still covers is a partial one, not a recovery.
  assert.deepEqual(
    classifySubagentEnd([question, failure(QUOTA), answer("Partial answer")], QUOTA),
    { status: "failed", error: QUOTA },
  );
});

test("a stored error is clamped to one bounded line", () => {
  const long = `quota exhausted\n\n${"details that go on and on ".repeat(200)}`;
  const end = classifySubagentEnd([question], long);
  assert.equal(end.status, "failed");
  assert.ok(end.status === "failed" && end.error.length <= 1_000, `kept ${end.status === "failed" ? end.error.length : 0} characters`);
  assert.ok(end.status === "failed" && end.error.startsWith("quota exhausted details that go on"), "whitespace runs collapse to one space");
  assert.ok(end.status === "failed" && !end.error.includes("\n") && end.error.endsWith("…"));
  assert.deepEqual(classifySubagentEnd([question, failure(`  ${QUOTA.replaceAll(" ", "\n  ")}  `)]), { status: "failed", error: QUOTA });
});

test("a reported record turns a legacy completed with nothing into a failure and keeps every other record as stored", () => {
  assert.deepEqual(reportedSubagentEnd({ status: "completed" }), { status: "failed", error: SUBAGENT_NO_REPLY });
  assert.deepEqual(reportedSubagentEnd({ status: "completed", summary: "   " }), { status: "failed", error: SUBAGENT_NO_REPLY });
  assert.deepEqual(reportedSubagentEnd({ status: "completed", summary: "Answer" }), { status: "completed", summary: "Answer" });
  assert.deepEqual(reportedSubagentEnd({ status: "failed", error: QUOTA }), { status: "failed", error: QUOTA });
  assert.deepEqual(reportedSubagentEnd({ status: "timed_out" }), { status: "timed_out" });
  assert.deepEqual(reportedSubagentEnd({ status: "cancelled" }), { status: "cancelled" });
});
