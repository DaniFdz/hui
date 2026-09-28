import assert from "node:assert/strict";
import test from "node:test";

import { latestRunError } from "./run-error.ts";
import type { TranscriptItem } from "./sessions-store.ts";

const user: TranscriptItem = { kind: "message", id: "u", role: "user", text: "rebase" };
const tool: TranscriptItem = { kind: "tool", id: "t", name: "bash", status: "succeeded", output: "ok" };
const failure: TranscriptItem = { kind: "error", id: "e", text: 'ai-gw-openai API error (500): {"message":"fetch failed"}' };

test("surfaces a settled run that ended in an error", () => {
  assert.deepEqual(latestRunError([user, tool, failure], false), {
    key: '1:ai-gw-openai API error (500): {"message":"fetch failed"}',
    summary: 'ai-gw-openai API error (500): {"message":"fetch failed"}',
    detail: 'ai-gw-openai API error (500): {"message":"fetch failed"}',
    multiline: false,
  });
});

test("hides the notice while streaming or once the turn continued", () => {
  assert.equal(latestRunError([user, tool, failure], true), undefined);
  assert.equal(latestRunError([user, failure, { kind: "message", id: "u2", role: "user", text: "Continue" }], false), undefined);
  assert.equal(latestRunError([user, failure, { kind: "message", id: "a", role: "assistant", text: "done" }], false), undefined);
  assert.equal(latestRunError([user, { kind: "error", id: "blank", text: "  " }], false), undefined);
});

test("keeps the key stable across refreshed row ids and summarises long diagnostics", () => {
  const live = latestRunError([user, { ...failure, id: "error-local" }], false);
  const refreshed = latestRunError([user, { ...failure, id: "history-4" }], false);
  assert.equal(live?.key, refreshed?.key);

  const stack = latestRunError([user, { kind: "error", id: "e", text: "Provider failed\n  at fetch (node:internal)" }], false);
  assert.equal(stack?.summary, "Provider failed");
  assert.equal(stack?.multiline, true);

  const long = latestRunError([user, { kind: "error", id: "e", text: "x".repeat(400) }], false);
  assert.equal(long?.summary.length, 160);
  assert.equal(long?.multiline, true);
  assert.equal(long?.detail.length, 400);
});
