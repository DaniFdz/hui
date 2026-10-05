import assert from "node:assert/strict";
import { test } from "node:test";
import { SpeechChunker, speakableInline, speakableLine, speakableText, speechChunks } from "./voice-speech.ts";

/** Streams `text` in pieces of `size` characters, the way a reply arrives. */
function stream(text: string, size: number, chunker = new SpeechChunker({ minChars: 1 })): { chunks: string[]; perPush: string[][] } {
  const perPush: string[][] = [];
  for (let index = 0; index < text.length; index += size) perPush.push(chunker.push(text.slice(index, index + size)));
  perPush.push(chunker.flush());
  return { chunks: perPush.flat(), perPush };
}

test("says what Markdown means, not its markup", () => {
  assert.equal(speakableInline("**Bold** and *italic* and __strong__, ~~gone~~ and `code`"), "Bold and italic and strong, gone and code");
  assert.equal(speakableInline("See [the docs](https://example.com/docs \"Docs\") or <https://www.github.com/x/y>."), "See the docs or github.com.");
  assert.equal(speakableInline("Open https://hui.example.org/path?q=1, then ![a chart](chart.png)"), "Open hui.example.org, then a chart");
  assert.equal(speakableInline("snake_case_names stay, 2*3 too, and \\*stars\\* unescape"), "snake_case_names stay, 2*3 too, and *stars* unescape");
  assert.equal(speakableInline("<b>bold</b> <br/> text"), "bold text");
  assert.deepEqual(speakableLine("## Today's plan ##"), { text: "Today's plan", ends: true });
  assert.deepEqual(speakableLine("- [x] **Ship** it"), { text: "Ship it", ends: true });
  assert.deepEqual(speakableLine("12. Call Ana"), { text: "Call Ana", ends: true });
  assert.deepEqual(speakableLine("> > quoted"), { text: "quoted", ends: false });
  for (const silent of ["| a | b |", "|---|---|", "---", "* * *", "   "]) assert.equal(speakableLine(silent), undefined, silent);
});

test("a whole message reads as sentences, without code or tables", () => {
  const message = [
    "# Plan",
    "Sure. Here is the plan for **today**:",
    "",
    "1. Review [PR 4](https://github.com/acme/hui/pull/4)",
    "2. Call Ana",
    "",
    "```ts",
    "const secret = 1;",
    "```",
    "| Task | Owner |",
    "| --- | --- |",
    "| Ship | Dani |",
    "",
    "That's all. Dr. Smith said 3.14 is fine, e.g. for now!",
  ].join("\n");
  assert.deepEqual(speechChunks(message, { minChars: 1 }), [
    "Plan.",
    "Sure.",
    "Here is the plan for today:",
    "Review PR 4.",
    "Call Ana.",
    "That's all.",
    "Dr. Smith said 3.14 is fine, e.g. for now!",
  ]);
  assert.equal(speakableText("**Hi** there.\n\n```\ncode\n```\nBye"), "Hi there. Bye.");
});

test("streams each sentence as soon as it is complete, in order, whatever the pieces", () => {
  const reply = "Good morning, Dani! The total is 3.14 euros. Mr. Brown called at 9.30 today. Anything else?";
  const expected = ["Good morning, Dani!", "The total is 3.14 euros.", "Mr. Brown called at 9.30 today.", "Anything else?"];
  for (const size of [1, 2, 3, 7, 50, reply.length]) assert.deepEqual(stream(reply, size).chunks, expected, `pieces of ${size}`);
  // The first sentence is out as soon as the next one begins, long before the reply ends.
  const { perPush } = stream(reply, 1);
  const firstAt = perPush.findIndex((chunks) => chunks.length > 0);
  assert.equal(perPush[firstAt]![0], "Good morning, Dani!");
  assert.equal(firstAt, "Good morning, Dani!".length, "handed out by the push that brings the space after it");
});

test("never speaks code, even when its fence arrives in pieces", () => {
  const { chunks } = stream("Here it is:\n```python\nprint('do not read me')\n```\nDone. Next step soon.", 2);
  assert.deepEqual(chunks, ["Here it is:", "Done.", "Next step soon."]);
  const unclosed = stream("Look:\n~~~\nraw = True\nstill code", 3);
  assert.deepEqual(unclosed.chunks, ["Look:"], "an unclosed fence stays code to the end");
});

test("waits for a line that starts with Markdown syntax, then says it whole", () => {
  const chunker = new SpeechChunker({ minChars: 1 });
  assert.deepEqual(chunker.push("- **First.** Then the rest"), [], "a list item is read once its line is complete");
  assert.deepEqual(chunker.push(" of it.\n"), ["First.", "Then the rest of it."]);
  assert.deepEqual(chunker.push("Plain text. More"), ["Plain text."]);
  assert.deepEqual(chunker.flush(), ["More."]);
});

test("starts with the first sentence, then groups short ones, and cuts a long one at a comma or space", () => {
  assert.deepEqual(speechChunks("Sure. Okay. Let me check the calendar for you. Done. Bye."), ["Sure.", "Okay. Let me check the calendar for you.", "Done. Bye."]);
  assert.deepEqual(speechChunks("Sure. Okay, fine.", { firstChars: 10 }), ["Sure. Okay, fine."], "a longer first chunk waits for more");
  const long = `${Array.from({ length: 30 }, (_, index) => `item ${index}`).join(", ")} and the rest without a stop`;
  const parts = speechChunks(long, { minChars: 1, maxChars: 80 });
  assert.ok(parts.length > 2);
  assert.ok(parts.every((part) => part.length <= 80), JSON.stringify(parts));
  assert.equal(parts.join(" ").replace(/\s+/gu, " "), `${long}.`);
});

test("reset drops what an interruption left unsaid", () => {
  const chunker = new SpeechChunker({ minChars: 1 });
  assert.deepEqual(chunker.push("First part. Second"), ["First part."]);
  chunker.reset();
  assert.deepEqual(chunker.push(" half.\nNew turn. "), ["half.", "New turn."]);
  assert.deepEqual(chunker.flush(), []);
});
