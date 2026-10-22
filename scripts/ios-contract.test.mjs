/**
 * The iOS app mirrors the core's own output by hand (plan 4.5, item 2), so this compares the kinds of the unions it
 * decodes with their Swift enums: `ChatProjectionRow` with `ChatRowKind`, and `TranscriptItem` with
 * `TranscriptItemKind` (ios/HUI/Chat/ChatRows.swift), apart from their `unrecognized` fallback.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "vitest";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

function unionKinds(source, type) {
  const start = source.indexOf(`export type ${type} =`);
  assert.ok(start >= 0, `${type} not found`);
  const body = source.slice(start, source.indexOf(";\n\n", start));
  return [...body.matchAll(/kind: "(\w+)"/gu)].map((match) => match[1]).sort();
}

function swiftCases(source, name) {
  const body = new RegExp(`enum ${name}: String[^{]*\\{([^}]*)\\}`, "u").exec(source)?.[1];
  assert.ok(body, `enum ${name} not found`);
  return [...body.matchAll(/case ([^\n]+)/gu)].flatMap((match) => match[1].split(",").map((name) => name.trim())).filter((name) => name !== "unrecognized").sort();
}

test("the Swift kind enums match the core's row and transcript item kinds", async () => {
  const swift = await read("ios/HUI/Chat/ChatRows.swift");
  assert.deepEqual(swiftCases(swift, "ChatRowKind"), unionKinds(await read("src/lib/chat-projection.ts"), "ChatProjectionRow"));
  assert.deepEqual(swiftCases(swift, "TranscriptItemKind"), unionKinds(await read("src/api/sessions.ts"), "TranscriptItem"));
});
