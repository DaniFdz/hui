import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";
import { taskSuggestionPrompt, taskSuggestionJiraDescription } from "./task-suggestions.ts";

const fixture: { input: { title: string; problem: string; fix: string }; prompt: string; jira: string }[] = JSON.parse(readFileSync(new URL("./task-suggestions.fixture.json", import.meta.url), "utf8"));

test("task-suggestions preserves the shared runtime fixtures", () => {
  for (const { input, prompt, jira } of fixture) {
    assert.equal(taskSuggestionPrompt(input), prompt);
    assert.equal(taskSuggestionJiraDescription(input), jira);
  }
});
