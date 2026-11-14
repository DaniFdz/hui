import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test, vi } from "vitest";
import type { HuiQuestion } from "./live-sessions.ts";
import type { SessionRecord } from "./sessions.ts";

// The registry path is read once, at import time, so the throwaway home has to be in place before the module is loaded.
process.env["XDG_CONFIG_HOME"] = await mkdtemp(join(tmpdir(), "hui-views-"));

const { boundedText, createSessionViews, questionView, runFailureMessage, transcriptRunFailed } = await import("./views.ts");
const { liveSessions } = await import("./live-sessions.ts");

afterEach(() => vi.restoreAllMocks());

const views = createSessionViews({
  bots: () => ({ identity: () => undefined }),
  botRegistry: { list: async () => [] },
  pullRequestStatuses: () => ({ view: (ref) => ref }),
  jiraIssues: () => [],
  watchers: () => ({ list: () => [] }),
});

const now = new Date(0).toISOString();
function record(id: string): SessionRecord {
  return { id, title: id, group: "", cwd: tmpdir(), tool: "pi", createdAt: now, updatedAt: now };
}

/** HUI's own pending questions, handed to the one session the tests ask about. */
const pending: HuiQuestion[] = [];
liveSessions.setHuiQuestionProvider((id) => id === "waiting" ? pending : []);

test("a view marks the run a conversation ends with when its last entry is that failure", () => {
  assert.equal(transcriptRunFailed([]), false);
  assert.equal(transcriptRunFailed([
    { kind: "message", role: "user", text: "take the coverage" },
    { kind: "message", role: "assistant", text: "done" },
  ]), false);
  assert.equal(transcriptRunFailed([
    { kind: "message", role: "user", text: "take the coverage" },
    { kind: "error", message: "API key auth failed for provider ai-gw-logical" },
  ]), true, "a failed model call leaves its error behind the turn that asked for it");
  assert.equal(transcriptRunFailed([
    { kind: "error", message: "provider failed" },
    { kind: "compaction", summary: "what was said", tokensBefore: 900 },
  ]), true, "a compaction after the failure still ends the conversation with it");
  assert.equal(transcriptRunFailed([
    { kind: "error", message: "provider failed" },
    { kind: "message", role: "user", text: "try again" },
    { kind: "message", role: "assistant", text: "done" },
  ]), false, "the next turn that answers replaces the failure");
});

test("a waiting session carries its question id, method and title, without the message body", () => {
  pending.splice(0, pending.length, {
    id: "secret-1", method: "secret", title: "Paste the  API\nkey", message: "the card's body stays out of the list",
  });
  const view = views.toView(record("waiting"), "waiting");
  assert.deepEqual(view.question, { id: "secret-1", method: "secret", title: "Paste the API key" });
  assert.equal("failure" in view, false);
  pending.length = 0;
});

test("only a select question carries options", () => {
  assert.deepEqual(questionView({ id: "pick", method: "select", title: "Which branch?", options: ["main", "release/2"] }), {
    id: "pick", method: "select", title: "Which branch?", options: ["main", "release/2"],
  });
  assert.deepEqual(questionView({ id: "confirm", method: "confirm", title: "Proceed?", message: "body" }), {
    id: "confirm", method: "confirm", title: "Proceed?",
  }, "a method without choices carries no options, even an empty array");
});

test("a question's title and options are bounded, and whitespace runs collapse", () => {
  assert.equal(questionView({ id: "input", method: "input", title: "Pick\n\n  one\tthing" }).title, "Pick one thing");
  assert.equal(boundedText("x".repeat(200), 200), "x".repeat(200), "text at the cap is kept whole");
  assert.equal(boundedText("abc def ghi", 8), "abc def…", "a word ending at the cap is kept");
  assert.equal(boundedText("abcdefghij", 8), "abcdefg…", "a single word is cut at the cap");
  const view = questionView({
    id: "many",
    method: "select",
    title: `Which ${"branch ".repeat(60)}now?`,
    options: Array.from({ length: 12 }, (_, index) => `${index} ${"word ".repeat(40)}`),
  });
  assert.ok(view.title.length <= 200);
  assert.ok(view.title.endsWith("…"));
  assert.equal("options" in view, false, "a list holding an option over 120 characters sends none, so no button renames a choice");
});

test("a select's options are sent exactly as the runtime offered them, and a list holding a long one sends none", () => {
  const exact = ["main  and  release", "one\ntwo", "tab\there", "x".repeat(120)];
  assert.deepEqual(questionView({ id: "pick", method: "select", title: "Which branch?", options: exact }).options, exact,
    "double spaces, newlines, tabs and an option at the cap come back byte for byte");

  const nine = Array.from({ length: 9 }, (_, index) => `choice ${index}`);
  assert.deepEqual(questionView({ id: "nine", method: "select", title: "Which?", options: nine }).options, nine.slice(0, 8),
    "a short list is cut at eight options, each one whole");

  const long = questionView({ id: "long", method: "select", title: "Which?", options: ["short", "y".repeat(120) + "z"] });
  assert.deepEqual(long, { id: "long", method: "select", title: "Which?" }, "one 121-character option leaves the whole list out");

  assert.equal(questionView({ id: "title", method: "select", title: "x".repeat(240), options: [] }).title.length, 200,
    "the title stays bounded by cutting it to 200 characters");
  assert.equal(questionView({ id: "title", method: "input", title: "x".repeat(240) }).title, "x".repeat(199) + "…",
    "a cut title ends in an ellipsis");
  const failure = runFailureMessage([{ kind: "error", message: `provider failed ${"no ".repeat(200)}` }]);
  assert.ok(failure && failure.length <= 240 && failure.endsWith("…"), "and a failure keeps its own 240-character bound");
});

test("a failed run carries its last error message, bounded", () => {
  assert.equal(runFailureMessage([
    { kind: "message", role: "user", text: "go" },
    { kind: "error", message: "first failure" },
    { kind: "message", role: "assistant", text: "retrying" },
    { kind: "error", message: "last   failure" },
  ]), "last failure");
  const long = runFailureMessage([{ kind: "error", message: `provider   failed\n${"no ".repeat(200)}` }]);
  assert.ok(long);
  assert.ok(long.length <= 240);
  assert.ok(long.startsWith("provider failed"));
  assert.ok(long.endsWith("…"));
  assert.equal(runFailureMessage([{ kind: "message", role: "assistant", text: "done" }], "runtime reported it"), "runtime reported it",
    "a live run without an error entry in its transcript names its own failure");
});

test("a failed session view carries its failure, and a healthy one carries neither field", () => {
  vi.spyOn(liveSessions, "transcript").mockReturnValue([
    { kind: "message", role: "user", text: "go" },
    { kind: "error", message: "provider   said\nno" },
  ]);
  const failed = views.toView(record("failed"), "error");
  assert.equal(failed.runFailed, true);
  assert.equal(failed.failure, "provider said no");
  vi.restoreAllMocks();

  const healthy = views.toView(record("healthy"), "idle");
  assert.equal("question" in healthy, false);
  assert.equal("failure" in healthy, false);
  assert.equal("runFailed" in healthy, false);
});
