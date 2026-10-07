import assert from "node:assert/strict";
import { test } from "node:test";
import { compactPrompt, compressStep, masterPrompt, mergeStep, SCALE_LINE, sizeFeedback, viewDoc } from "./prompts.ts";

test("the scale line is exactly 512 UTF-8 bytes, dense and tagged with kinds", () => {
  assert.equal(Buffer.byteLength(SCALE_LINE, "utf8"), 512);
  for (const kind of ["user:", "talk:", "tool:", "echo:", "work:"]) assert(SCALE_LINE.includes(kind), kind);
  assert(!SCALE_LINE.includes("\n"));
});

test("the prompts are the spec's, for the agent's name, and name no user", () => {
  const compact = compactPrompt("Grok");
  assert(compact.startsWith("You write the memory of Grok, an AI agent that works for one user in one\nendless chat"));
  assert(compact.endsWith("Output only the line; non-ASCII characters cost 2-4 bytes."));
  assert(!compact.includes("OptChat"));
  assert.equal(compact.split("Grok").length - 1, 11, "every mention renamed");
  assert(masterPrompt("Grok").startsWith("You are Grok, an AI agent that works for one user in a single chat that\nnever ends."));
  const doc = viewDoc("Grok");
  assert(doc.includes("before\nyou act, guess or ask. date(id) gives the date and time of message id."), "zoom before you act, guess or ask");
  assert(doc.includes("A message not summarized yet shows as \"(not summarized yet: zoom it)\"."));
  assert(!masterPrompt("Grok").includes("OptChat") && !doc.includes("OptChat"));
  assert.equal(compactPrompt("A$&B").split("A$&B").length - 1, 11, "a name is literal text, never a replacement pattern");
});

test("compactor steps say what to do with the message or the two lines, under the scale line", () => {
  assert.equal(compressStep("ab", 512, "user", "line one\nline two"),
    "For scale, this line is exactly 2 bytes:\nab\n\nCompress this message into one line, in at most 512 bytes:\nuser: line one\nline two");
  assert.equal(mergeStep("ab", 64, "user: a\nb", "talk: c"),
    "For scale, this line is exactly 2 bytes:\nab\n\nMerge these two lines into one, in at most 64 bytes:\nuser: a b\ntalk: c");
  assert.equal(sizeFeedback(600, 512, "cut"), "That line is 600 bytes; the limit is 512. It must end where it is cut here:\ncut| ← LIMIT");
});
