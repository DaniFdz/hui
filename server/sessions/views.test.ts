import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";

// The registry path is read once, at import time, so the throwaway home has to be in place before the module is loaded.
process.env["XDG_CONFIG_HOME"] = await mkdtemp(join(tmpdir(), "hui-views-"));

const { transcriptRunFailed } = await import("./views.ts");

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
