/** The composer's slash menu draws its sections in the order the ranked commands reach them. */
import assert from "node:assert/strict";
import { test } from "vitest";
import type { RuntimeCommand } from "../api/sessions.ts";
import { composerCommands, filterSlashCommands } from "../lib/composer/slash-commands.ts";
import { renderSlashMenu } from "./slash-menu.ts";

/** A Lit template's markup, with bound values written out. */
function markup(value: unknown): string {
  if (Array.isArray(value)) return value.map(markup).join("");
  if (value && typeof value === "object" && "strings" in value && "values" in value) {
    const template = value as { strings: readonly string[]; values: unknown[] };
    return template.strings.map((part, i) => part + markup(template.values[i])).join("");
  }
  return ["string", "number", "boolean"].includes(typeof value) ? String(value) : "";
}

const commands: RuntimeCommand[] = [
  { name: "view-pr", description: "Open the current branch's PR in the browser", source: "extension" },
  { name: "skill:datadog-browser", description: "Open a page in the browser", source: "skill" },
  { name: "skill:bro", description: "Restate the last message in plain human language", source: "skill" },
];

function menu(query: string): string {
  return markup(renderSlashMenu({
    open: true, commands: filterSlashCommands(composerCommands(commands), query), activeIndex: 0,
    loading: false, error: "", streaming: false, onSelect: () => {}, onRetry: () => {},
  }));
}

test("the section holding the exact name match comes first, so Enter completes that name", () => {
  const html = menu("bro");
  assert.deepEqual([...html.matchAll(/class="slash-menu-name">([^<]+)</gu)].map((match) => match[1]), ["$bro", "$datadog-browser", "$view-pr"]);
  assert.ok(html.indexOf(">Skills<") < html.indexOf(">Plugin actions<"));
  assert.deepEqual([...html.matchAll(/id=composer-slash-commands-(\d+)/gu)].map((match) => match[1]), ["0", "1", "2"]);
  assert.match(html, /id=composer-slash-commands-0\s[^>]*aria-selected=true/u);
});

test("a section that only mentions the query in a description ranks last", () => {
  const html = menu("browser");
  assert.deepEqual([...html.matchAll(/class="slash-menu-name">([^<]+)</gu)].map((match) => match[1]), ["$datadog-browser", "$view-pr"]);
});
