import assert from "node:assert/strict";
import { test } from "vitest";

import { progressCardSummary } from "./progress-card.ts";

test("sidebar summaries distinguish pending, active, complete and notes-only cards", () => {
  assert.deepEqual(progressCardSummary({ markdown: "Notes", steps: [] }), { label: "Agent notes", count: "" });
  assert.deepEqual(progressCardSummary({ markdown: "", steps: [{ step: "Ship", status: "completed" }] }), { label: "Completed", count: "1/1" });
  assert.deepEqual(progressCardSummary({ markdown: "", steps: [
    { step: "Later", status: "pending" }, { step: "Now", status: "in_progress" }, { step: "Done", status: "completed" },
  ] }), { label: "Now", count: "1/3" });
  assert.deepEqual(progressCardSummary({ markdown: "", steps: [{ step: "Next", status: "pending" }] }), { label: "Next", count: "0/1" });
});
