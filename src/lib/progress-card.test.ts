import assert from "node:assert/strict";
import test from "node:test";

import { parseProgressCard, progressCardFromTranscript, progressCardSummary } from "./progress-card.ts";

test("parses bounded progress_card plans and rejects invented states", () => {
  assert.deepEqual(parseProgressCard({ plan: [
    { step: "Done", status: "completed" },
    { step: "Working", status: "in_progress" },
    { step: "Wrong", status: "failed" },
  ] }), {
    markdown: "",
    steps: [
      { step: "Done", status: "completed" },
      { step: "Working", status: "in_progress" },
    ],
  });
});

test("the latest progress call replaces or clears the previous card", () => {
  const first = { kind: "tool" as const, id: "one", name: "progress_card", args: { plan: [{ step: "One", status: "pending" }] }, status: "succeeded" as const };
  const unrelated = { kind: "tool" as const, id: "read", name: "read", args: {}, status: "succeeded" as const };
  assert.equal(progressCardFromTranscript([first, unrelated])?.steps[0]?.step, "One");
  assert.equal(progressCardFromTranscript([first, { ...first, id: "clear", args: {} }]), undefined);
});

test("sidebar summaries distinguish pending, active, complete and notes-only cards", () => {
  assert.deepEqual(progressCardSummary({ markdown: "Notes", steps: [] }), { label: "Agent notes", count: "" });
  assert.deepEqual(progressCardSummary({ markdown: "", steps: [{ step: "Ship", status: "completed" }] }), { label: "Completed", count: "1/1" });
  assert.deepEqual(progressCardSummary({ markdown: "", steps: [
    { step: "Later", status: "pending" }, { step: "Now", status: "in_progress" }, { step: "Done", status: "completed" },
  ] }), { label: "Now", count: "1/3" });
  assert.deepEqual(progressCardSummary({ markdown: "", steps: [{ step: "Next", status: "pending" }] }), { label: "Next", count: "0/1" });
});
