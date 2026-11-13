import assert from "node:assert/strict";
import { test } from "vitest";
import { SEARCH_BYTES, SEARCH_LIMIT, SEARCH_MAX, SEARCH_SNIPPET, searchLog } from "./search.ts";
import type { Kind, MessageLine } from "./store.ts";

/** A chat of `texts`, one message each: `size` is what the log stores for `kind: text`. */
function chat(texts: readonly (readonly [Kind, string])[]): MessageLine[] {
  return texts.map(([kind, text], i) => ({ i, kind, text, size: Buffer.byteLength(`${kind}: ${text}`, "utf8"), date: `2026-10-05T19:09:${String(i).padStart(2, "0")}.000Z` }));
}

const sample = chat([
  ["user", "we never deploy on Fridays"],
  ["talk", "Noted."],
  ["tool", 'read {"path":"docs/deploy.md"}'],
  ["echo", "Deploys run on Tuesdays.\nFridays are frozen."],
]);

/** Messages with the sizes the log would hold for them, so a scan's bounds are exact. */
const sized = (...entries: (readonly [size: number, text: string])[]): MessageLine[] =>
  entries.map(([size, text], i) => ({ i, kind: "talk", text, size, date: `2026-10-05T19:09:${String(i).padStart(2, "0")}.000Z` }));

test("search answers with the messages that mention the query, newest first, as the view's id+1 lines", () => {
  assert.equal(searchLog(sample, "fridays"), [
    `2 lines mention "fridays", newest first:`,
    `3+1|echo: Deploys run on Tuesdays. Fridays are frozen.`,
    `0+1|user: we never deploy on Fridays`,
  ].join("\n"));
  assert.equal(searchLog(sample, "TUESDAY"), [
    `1 line mentions "TUESDAY", newest first:`,
    `3+1|echo: Deploys run on Tuesdays. Fridays are frozen.`,
  ].join("\n"), "case-insensitive, and the query is answered as it was written");
  assert.match(searchLog(sample, "  fridays "), /^2 lines mention "fridays", newest first:/u, "the query is trimmed");
});

test("a query matches the line as the view writes it, kind included, and a message's newlines become spaces", () => {
  assert.deepEqual(searchLog(sample, "tool: read").split("\n"), [`1 line mentions "tool: read", newest first:`, `2+1|tool: read {"path":"docs/deploy.md"}`]);
  assert.deepEqual(searchLog(sample, "Tuesdays. Fridays").split("\n"), [`1 line mentions "Tuesdays. Fridays", newest first:`, `3+1|echo: Deploys run on Tuesdays. Fridays are frozen.`], "across the newline");
  assert.deepEqual(searchLog(sample, "user: we never deploy on fridays").split("\n").at(-1), `0+1|user: we never deploy on Fridays`);
  assert(!searchLog(sample, "fridays").includes("\nNoted."), "a hit is one line, never the message whole");
});

test("search says so when nothing mentions the query, and refuses an empty one", () => {
  assert.equal(searchLog(sample, "saturdays"), `No line mentions "saturdays" in the chat.`);
  assert.equal(searchLog([], "anything"), `No line mentions "anything" in the chat.`);
  assert.deepEqual([searchLog(sample, ""), searchLog(sample, "   "), searchLog(sample, "\n\n")], ["No word to search for.", "No word to search for.", "No word to search for."]);
});

test("search shows at most its limit, the newest matches first, and says it stopped there", () => {
  const many = chat(Array.from({ length: 30 }, (_, i) => ["user", `note ${i} about the cache`] as const));
  const answer = searchLog(many, "cache").split("\n");
  assert.equal(answer[0], `${SEARCH_LIMIT} lines mention "cache", newest first:`);
  assert.equal(answer.length, SEARCH_LIMIT + 2, "the header, one line per hit, the limit's note");
  assert.equal(answer[1], `29+1|user: note 29 about the cache`, "the newest match comes first");
  assert.equal(answer.at(-1), `[at most ${SEARCH_LIMIT} shown]`);
  assert.deepEqual(searchLog(many, "cache", 3).split("\n"), [
    `3 lines mention "cache", newest first:`, `29+1|user: note 29 about the cache`, `28+1|user: note 28 about the cache`, `27+1|user: note 27 about the cache`, `[at most 3 shown]`,
  ]);
  assert.deepEqual(searchLog(many, "cache", SEARCH_MAX).split("\n").slice(0, 1), [`30 lines mention "cache", newest first:`], "more asked for than there are");
  assert(!searchLog(many, "cache", SEARCH_MAX).includes("at most"));
  assert.equal(searchLog(many, "cache", 0).split("\n")[0], `1 line mentions "cache", newest first:`, "a limit below one is one");
  assert.deepEqual(searchLog(sample, "fridays", 2).split("\n"), [`2 lines mention "fridays", newest first:`, `3+1|echo: Deploys run on Tuesdays. Fridays are frozen.`, `0+1|user: we never deploy on Fridays`], "the limit and the last match meet: nothing was skipped, so nothing says it was");
});

test("a hit is a snippet: at most SEARCH_SNIPPET bytes of it, cut where the bytes end and marked", () => {
  const long = chat([["talk", `start ${"é".repeat(400)} end`]]);
  const text = searchLog(long, "start").split("\n")[1]!.slice("0+1|talk: ".length);
  assert(text.startsWith("start ééé"), "the snippet keeps the head, where the match is");
  assert(text.endsWith("…"), "a cut snippet says so");
  assert(Buffer.byteLength(text.slice(0, -1), "utf8") <= SEARCH_SNIPPET, `${Buffer.byteLength(text, "utf8")} bytes`);
  assert(!text.includes(" end"), "and never the whole message");
});

test("search reads the newest messages only, and says which it read", () => {
  const log = sized([10, "keep 5"], [10, "mic drop"], [10, "keep 3"], [10, "keep 2"], [10, "keep 1"], [10, "keep 0"]);
  assert.equal(searchLog(log, "zzz", undefined, { bytes: 25 }), `No line mentions "zzz" in the newest 3 of 6 messages.`, "the byte budget stopped the scan");
  assert.equal(searchLog(log, "keep", 2, { bytes: 25 }), [
    `2 lines mention "keep", newest first:`, `5+1|talk: keep 0`, `4+1|talk: keep 1`, `[at most 2 shown]`,
  ].join("\n"), "the hit limit stops it first, so there is nothing more to read");
  assert.equal(searchLog(log, "keep", 20, { bytes: 25 }), [
    `3 lines mention "keep", newest first:`, `5+1|talk: keep 0`, `4+1|talk: keep 1`, `3+1|talk: keep 2`, `[searched the newest 3 of 6 messages]`,
  ].join("\n"), "a scan cut short says so");
  assert.equal(searchLog(log, "keep").split("\n").length, 6, "a chat within both bounds is read whole, with no note");
});

test("its bounds are the ones a search answers within", () => {
  const one = (size: number, text: string, i: number): MessageLine => ({ i, kind: "echo", text, size, date: "2026-10-05T19:09:33.000Z" });
  const half = [one(SEARCH_BYTES / 2, "keep first", 0), one(SEARCH_BYTES / 2, "keep second", 1)];
  assert.deepEqual(searchLog(half, "keep").split("\n"), [`2 lines mention "keep", newest first:`, `1+1|echo: keep second`, `0+1|echo: keep first`], "exactly the byte budget is read whole, with no note");
  const heavy = [one(SEARCH_BYTES, "first", 0), one(SEARCH_BYTES, "second", 1), one(SEARCH_BYTES, "third", 2)];
  assert.equal(searchLog(heavy, "first"), `No line mentions "first" in the newest 1 of 3 messages.`, `one message of ${SEARCH_BYTES} bytes is all the budget holds`);
  const small = sized([1, "needle"], [1, "x"], [1, "y"], [1, "z"]);
  assert.equal(searchLog(small, "needle", undefined, { scan: 3 }), `No line mentions "needle" in the newest 3 of 4 messages.`, "the scan bound counts messages");
  assert.deepEqual(searchLog(small, "needle", undefined, { scan: 4 }).split("\n"), [`1 line mentions "needle", newest first:`, `0+1|talk: needle`], "a bound as long as the log reads all of it");
});

test("a search's own call is never one of its hits", () => {
  const log = chat([
    ["user", "the cache is warm"],
    ["tool", 'search_chat {"query":"cache"}'],
    ["echo", '1 line mentions "cache", newest first:'],
  ]);
  assert.deepEqual(searchLog(log, "cache").split("\n"), [
    `2 lines mention "cache", newest first:`,
    `2+1|echo: 1 line mentions "cache", newest first:`,
    `0+1|user: the cache is warm`,
  ], "the call that asked is skipped, a result an earlier search logged is not");
  assert.equal(searchLog(log, "search_chat"), `No line mentions "search_chat" in the chat.`);
});
