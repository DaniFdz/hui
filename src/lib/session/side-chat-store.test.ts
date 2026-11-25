import assert from "node:assert/strict";
import { test } from "vitest";
import { clearSideChat, settleSideChat, sideChatFor, startSideChat, subscribeSideChat } from "./side-chat-store.ts";

test("a question shows as loading, then keeps its answer and model until the next one replaces it", () => {
  startSideChat("btw-alpha", "which file are we editing?");
  assert.deepEqual(sideChatFor("btw-alpha"), {
    question: "which file are we editing?", answer: "", model: "", loading: true, error: "",
  });

  settleSideChat("btw-alpha", { answer: "`home.ts`", model: "utility-fixture" });
  assert.deepEqual(sideChatFor("btw-alpha"), {
    question: "which file are we editing?", answer: "`home.ts`", model: "utility-fixture", loading: false, error: "",
  });

  startSideChat("btw-alpha", "and the branch?");
  assert.equal(sideChatFor("btw-alpha")?.answer, "", "a new question never shows the previous answer");
  assert.equal(sideChatFor("btw-alpha")?.model, "");
});

test("a failure replaces the answer and clears the model", () => {
  startSideChat("btw-beta", "summarize this");
  settleSideChat("btw-beta", { error: "The side question failed." });
  assert.deepEqual(sideChatFor("btw-beta"), {
    question: "summarize this", answer: "", model: "", loading: false, error: "The side question failed.",
  });
});

test("an answer that arrives after its exchange was cleared or closed is dropped", () => {
  settleSideChat("btw-gamma", { answer: "too late", model: "utility-fixture" });
  assert.equal(sideChatFor("btw-gamma"), undefined);

  startSideChat("btw-gamma", "still there?");
  clearSideChat("btw-gamma");
  settleSideChat("btw-gamma", { answer: "too late", model: "utility-fixture" });
  assert.equal(sideChatFor("btw-gamma"), undefined, "closing the side chat never resurrects it");
});

test("a new question asks to come forward; an answer, a failure and a close only redraw", () => {
  const events: Array<{ sessionId: string; opened: boolean }> = [];
  const stop = subscribeSideChat((event) => events.push(event));
  startSideChat("btw-delta", "what changed?");
  settleSideChat("btw-delta", { answer: "one file", model: "utility-fixture" });
  startSideChat("btw-delta", "and now?");
  settleSideChat("btw-delta", { error: "no answer" });
  clearSideChat("btw-delta");
  stop();
  startSideChat("btw-delta", "unheard");
  assert.deepEqual(events, [
    { sessionId: "btw-delta", opened: true },
    { sessionId: "btw-delta", opened: false },
    { sessionId: "btw-delta", opened: true },
    { sessionId: "btw-delta", opened: false },
    { sessionId: "btw-delta", opened: false },
  ]);
});
