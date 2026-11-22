/** The prompt section that offers HUI's declarative formats: every capability gets its own line, and the line for a
 * session reference names the syntax and the shortest prefix that resolves. Nothing here renders. */
import assert from "node:assert/strict";
import { test } from "vitest";
import { HUI_PRESENTATION_CAPABILITIES, HUI_PRESENTATION_PROMPT } from "./hui-presentation.ts";

/** The bullet lines of the prompt section, by capability id. */
function guidanceLines(): Map<string, string> {
  const lines = HUI_PRESENTATION_PROMPT.split("\n").filter((line) => line.startsWith("- "));
  return new Map(lines.map((line) => [line.slice(2, line.indexOf(":")), line]));
}

test("the prompt section lists every capability once, on its own line", () => {
  const lines = guidanceLines();
  const ids = HUI_PRESENTATION_CAPABILITIES.map(({ id }) => id);
  assert.equal(new Set(ids).size, ids.length, "an id names one capability");
  for (const id of ids) assert.ok(lines.has(id), `the prompt names ${id}`);
  const bullets = HUI_PRESENTATION_PROMPT.split("\n").filter((line) => line.startsWith("- "));
  assert.equal(bullets.length, ids.length + 1, "one line per capability, plus what HUI escapes");
});

test("the session line names the syntax and the shortest prefix that resolves", () => {
  const line = guidanceLines().get("session");
  assert.ok(line, "an agent can discover the session reference");
  assert.match(line, /`session:<id>`/u);
  assert.match(line, /prefix of at least 8 characters/u);
  assert.match(line, /unique prefix/u, "a prefix two sessions share stays text");
});
