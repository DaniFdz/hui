import assert from "node:assert/strict";
import test from "node:test";
import { activityLabel, browserPreviewRow, projectChatTranscript, workingLabel } from "./projection.ts";

test("groups assistant context into one disclosure and leaves only the final answer visible", () => {
  const rows = projectChatTranscript([
    { kind: "message", id: "u1", role: "user", text: "one" },
    { kind: "message", id: "u2", role: "user", text: "two" },
    { kind: "message", id: "preamble", role: "assistant", text: "I will check." },
    { kind: "thinking", id: "r", text: "plan" },
    { kind: "tool", id: "t", name: "read", status: "succeeded", output: "ok" },
    { kind: "message", id: "a", role: "assistant", text: "done" },
  ]);
  assert.deepEqual(rows.map((row) => [row.kind, row.kind === "messages" ? row.role : "items" in row ? row.items.length : 0]), [
    ["messages", "user"],
    ["activity", 3],
    ["messages", "assistant"],
  ]);
  assert.equal(rows[0]?.kind === "messages" && rows[0].messages.length, 2);
  assert.equal(rows[1]?.kind === "activity" && rows[1].items[0]?.kind, "message");
  assert.equal(rows[2]?.kind === "messages" && rows[2].messages[0]?.text, "done");
});

test("a compaction marker stays its own row between completed turns", () => {
  const rows = projectChatTranscript([
    { kind: "message", id: "u1", role: "user", text: "one" },
    { kind: "tool", id: "t", name: "read", status: "succeeded", output: "ok" },
    { kind: "message", id: "a1", role: "assistant", text: "done" },
    { kind: "compaction", id: "c", summary: "## Goal", tokensBefore: 120_000 },
    { kind: "message", id: "u2", role: "user", text: "two" },
  ]);
  assert.deepEqual(rows.map((row) => `${row.kind}:${row.id}`), ["messages:u1", "activity:t", "messages:a1", "compaction:c", "messages:u2"]);
});

test("interleaves live assistant updates with collapsed tool batches", () => {
  const rows = projectChatTranscript([
    { kind: "message", id: "u", role: "user", text: "check" },
    { kind: "message", id: "preamble", role: "assistant", text: "Checking." },
    { kind: "tool", id: "t1", name: "read", status: "succeeded" },
    { kind: "tool", id: "t2", name: "bash", status: "succeeded" },
    { kind: "message", id: "checkpoint", role: "assistant", text: "I found the cause." },
    { kind: "thinking", id: "r", text: "verify the fix" },
    { kind: "tool", id: "t3", name: "bash", status: "running" },
  ], true);
  assert.deepEqual(rows.map((row) => row.kind === "messages" ? `${row.role}:${row.messages[0]?.text}` : "items" in row ? `activity:${row.items.length}` : row.kind), [
    "user:check", "assistant:Checking.", "activity:2", "assistant:I found the cause.", "activity:2",
  ]);
});

test("settling the same turn hides intermediate updates and leaves the final response", () => {
  const transcript = [
    { kind: "message" as const, id: "u", role: "user" as const, text: "check" },
    { kind: "message" as const, id: "preamble", role: "assistant" as const, text: "Checking." },
    { kind: "tool" as const, id: "t1", name: "read", status: "succeeded" as const },
    { kind: "message" as const, id: "checkpoint", role: "assistant" as const, text: "I found the cause." },
    { kind: "tool" as const, id: "t2", name: "bash", status: "succeeded" as const },
    { kind: "message" as const, id: "final", role: "assistant" as const, text: "Fixed." },
  ];

  const live = projectChatTranscript(transcript, true);
  const settled = projectChatTranscript(transcript, false);
  assert.deepEqual(live.map((row) => row.kind), ["messages", "messages", "activity", "messages", "activity", "messages"]);
  assert.deepEqual(settled.map((row) => row.kind), ["messages", "activity", "messages"]);
  assert.equal(settled[1]?.kind === "activity" && settled[1].items.length, 4);
  assert.equal(settled[2]?.kind === "messages" && settled[2].messages[0]?.text, "Fixed.");
});

test("keeps presented media visible outside collapsed run details", () => {
  const rows = projectChatTranscript([
    { kind: "message", id: "u", role: "user", text: "show it" },
    { kind: "tool", id: "read", name: "read", status: "succeeded" },
    { kind: "tool", id: "media", name: "present_media", status: "succeeded", details: { media: [] } },
    { kind: "tool", id: "check", name: "bash", status: "succeeded" },
    { kind: "message", id: "a", role: "assistant", text: "Here it is." },
  ]);
  assert.deepEqual(rows.map((row) => row.kind === "messages" ? row.role : row.kind === "activity" ? row.items.map((item) => item.id).join(",") : row.kind), [
    "user", "read", "media", "check", "assistant",
  ]);
});

test("starts a fresh grouped run after every user message", () => {
  const rows = projectChatTranscript([
    { kind: "message", id: "u1", role: "user", text: "one" },
    { kind: "tool", id: "t1", name: "read", status: "succeeded" },
    { kind: "message", id: "a1", role: "assistant", text: "first" },
    { kind: "message", id: "u2", role: "user", text: "two" },
    { kind: "tool", id: "t2", name: "write", status: "succeeded" },
    { kind: "message", id: "a2", role: "assistant", text: "second" },
  ]);
  assert.deepEqual(rows.map((row) => row.kind === "messages" ? `${row.role}:${row.messages[0]?.text}` : "activity"), [
    "user:one", "activity", "assistant:first", "user:two", "activity", "assistant:second",
  ]);
});

test("activity labels prefer the live tool and otherwise summarize hidden commands", () => {
  assert.equal(activityLabel([{ kind: "thinking", id: "r", text: "plan" }], true), "Thinking…");
  assert.equal(activityLabel([{ kind: "tool", id: "t", name: "bash", status: "running" }], true), "bash…");
  assert.equal(activityLabel([
    { kind: "tool", id: "a", name: "read", status: "succeeded" },
    { kind: "tool", id: "b", name: "bash", status: "running" },
  ], true), "Ran 2 commands…");
  assert.equal(activityLabel([
    { kind: "tool", id: "a", name: "read", status: "succeeded" },
    { kind: "tool", id: "b", name: "write", status: "succeeded" },
  ], false), "Ran 2 commands, edited 1 file");
});

test("working labels stay contextual without exposing thinking content", () => {
  assert.equal(workingLabel([{ kind: "thinking", id: "r", text: "private reasoning" }]), "Thinking…");
  assert.equal(workingLabel([{ kind: "tool", id: "t", name: "read_file", status: "running" }]), "Reading files…");
  assert.equal(workingLabel([{ kind: "tool", id: "t", name: "apply_patch", status: "running" }]), "Editing files…");
  assert.equal(workingLabel([{ kind: "tool", id: "t", name: "bash", status: "running" }]), "Running command…");
  assert.equal(workingLabel([{ kind: "message", id: "a", role: "assistant", text: "partial" }]), "Writing response…");
});

test("collapses a long tool-heavy run into one activity row", () => {
  const tools = Array.from({ length: 17 }, (_, index) => ({
    kind: "tool" as const,
    id: `tool-${index}`,
    name: index < 5 ? "apply_patch" : "bash",
    status: "succeeded" as const,
  }));
  const rows = projectChatTranscript([
    { kind: "message", id: "user", role: "user", text: "implement it" },
    { kind: "message", id: "preamble", role: "assistant", text: "I will check." },
    ...tools,
    { kind: "message", id: "answer", role: "assistant", text: "Done." },
  ]);

  assert.equal(rows.length, 3);
  assert.equal(rows[1]?.kind, "activity");
  assert.equal(rows[1]?.kind === "activity" && rows[1].items.length, 18);
  assert.equal(rows[1]?.kind === "activity" && activityLabel(rows[1].items, false), "Ran 17 commands, edited 5 files");
});

test("the browser preview sits under the latest browser activity and knows whether its turn is current", () => {
  const settled = projectChatTranscript([
    { kind: "message", id: "u1", role: "user", text: "look it up" },
    { kind: "tool", id: "b1", name: "browser", status: "succeeded" },
    { kind: "tool", id: "r1", name: "read", status: "succeeded" },
    { kind: "message", id: "a1", role: "assistant", text: "found it" },
    { kind: "message", id: "u2", role: "user", text: "now build it" },
    { kind: "tool", id: "x1", name: "bash", status: "succeeded" },
    { kind: "message", id: "a2", role: "assistant", text: "built" },
  ]);
  assert.deepEqual(browserPreviewRow(settled), { index: 1, pending: false, currentTurn: false }, "a later prompt ends the preview's turn");

  const live = projectChatTranscript([
    { kind: "message", id: "u1", role: "user", text: "look it up" },
    { kind: "tool", id: "b1", name: "browser", status: "succeeded" },
    { kind: "message", id: "note", role: "assistant", text: "Checking the second page." },
    { kind: "tool", id: "b2", name: "browser", status: "succeeded" },
    { kind: "tool", id: "b3", name: "browser", status: "running" },
  ], true);
  assert.deepEqual(browserPreviewRow(live), { index: 3, pending: true, currentTurn: true }, "only the newest browser batch carries it");

  const subagent = projectChatTranscript([
    { kind: "message", id: "u1", role: "user", text: "look it up" },
    { kind: "tool", id: "b1", name: "browser", status: "succeeded" },
    { kind: "message", id: "a1", role: "assistant", text: "delegated" },
    { kind: "message", id: "e1", role: "user", text: "[HUI subagent completion event]\nnot parsed" },
  ]);
  assert.deepEqual(browserPreviewRow(subagent), { index: 1, pending: false, currentTurn: false }, "a HUI-injected event also starts a new turn");
  // Deterministic providers (and retries) can reuse tool call ids across turns.
  const repeated = projectChatTranscript([
    { kind: "message", id: "u1", role: "user", text: "first" },
    { kind: "tool", id: "same", name: "browser", status: "succeeded" },
    { kind: "message", id: "a1", role: "assistant", text: "one" },
    { kind: "message", id: "u2", role: "user", text: "again" },
    { kind: "tool", id: "same", name: "browser", status: "running" },
  ], true);
  assert.deepEqual(browserPreviewRow(repeated), { index: 4, pending: true, currentTurn: true });
  assert.equal(repeated[1]?.id, repeated[4]?.id, "both rows share an id; the index tells them apart");
  assert.equal(browserPreviewRow(projectChatTranscript([
    { kind: "message", id: "u1", role: "user", text: "no browsing" },
    { kind: "tool", id: "t1", name: "read", status: "succeeded" },
    { kind: "message", id: "a1", role: "assistant", text: "done" },
  ])), undefined);
});
