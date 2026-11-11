import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";
import { answeredCount } from "./questionnaire-card.ts";

const source = readFileSync(new URL("./questionnaire-card.ts", import.meta.url), "utf8");
const styles = readFileSync(new URL("../styles/openclaw-chat.css", import.meta.url), "utf8");

test("the card's own top line folds it to one row, and the row opens it again", () => {
  // The open header is a button: its name is the title and the progress the operator already reads.
  assert.match(source, /class="chat-question-panel__topline questionnaire-card__fold" aria-expanded="true" data-testid="question-fold"/u);
  assert.doesNotMatch(source, /class="chat-question-panel__collapse"/u);
  // Folded, the same row keeps where the operator is and how much they answered.
  assert.match(source, /class="session-question-card chat-question-panel questionnaire-card questionnaire-card--collapsed chat-question-panel--collapsed"/u);
  assert.match(source, /class="chat-question-panel__collapsed-button" aria-expanded="false" data-testid="question-unfold"/u);
  assert.match(source, /class="chat-question-panel__progress" aria-label=\$\{`Question \$\{this\.step \+ 1\} of \$\{questions\.length\}`\}>\$\{this\.step \+ 1\}\/\$\{questions\.length\}/u);
  assert.match(source, /`\$\{done\} answered`/u);
  // Opening it puts focus back on the question's options, as opening the card does.
  const fold = source.slice(source.indexOf("#fold(folded: boolean)"), source.indexOf("#advance(): void"));
  assert.match(fold, /this\.collapsed = folded;/u);
  assert.match(fold, /if \(folded\) this\.querySelector<HTMLElement>\("\.chat-question-panel__collapsed-button"\)\?\.focus\(\);\s*else this\.focusCurrent\(\);/u);
  // Picks live in `drafts`, which folding never touches; only a new call's card starts over unfolded.
  assert.doesNotMatch(fold, /this\.drafts|this\.step/u);
  assert.match(source, /A new call's questions open in full[\s\S]{0,80}this\.collapsed = false;/u);
});

test("a folded card takes Escape as opening it, never as cancelling the questions", () => {
  const keydown = source.slice(source.indexOf("#keydown(event: KeyboardEvent): void"), source.indexOf("#focusRow("));
  const folded = keydown.slice(keydown.indexOf("if (this.collapsed)"), keydown.indexOf("const target = event.target"));
  assert.match(folded, /if \(event\.key !== "Escape"\) return;/u);
  assert.match(folded, /event\.preventDefault\(\);\s*this\.#fold\(false\);/u);
  assert.doesNotMatch(folded, /cancelled/u);
});

test("a folded card counts the questions that already have an answer", () => {
  const options = { header: "Pick", question: "Which?", multiSelect: false, options: [], input: "options" as const };
  const text = { header: "Notes", question: "Anything?", multiSelect: false, options: [], input: "text" as const };
  const slider = { header: "Hours", question: "How many?", multiSelect: false, options: [], input: "slider" as const, min: 0, max: 10, step: 1 };
  const draft = (selected: string[], custom = "", customChosen = false, extra = {}) => ({ selected, custom, customChosen, slider: 5, text: "", ...extra });
  assert.equal(answeredCount([], []), 0);
  assert.equal(answeredCount([options, options, options, options], [
    draft(["Postgres"]),
    draft([], "   ", true),
    draft([], "DynamoDB", true),
    draft(["Lint", "Unit tests"]),
  ]), 3);
  assert.equal(answeredCount([slider, text], [draft([]), draft([], "", false)]), 1, "a slider always has an answer");
});

test("both fold controls are buttons, and the folded bar stays inside the panel's corners", () => {
  assert.match(styles, /\.questionnaire-card__fold \{[^}]*width: 100%;[^}]*border: 0;[^}]*cursor: var\(--cursor-action\);/su);
  assert.match(styles, /\.questionnaire-card__fold:focus-visible \{[^}]*outline: 2px solid var\(--ring\);/su);
  assert.match(styles, /\.questionnaire-card\.chat-question-panel--collapsed \{[^}]*grid-template-columns: minmax\(0, 1fr\);[^}]*gap: 0;/su);
  assert.match(styles, /\.questionnaire-card--collapsed \.chat-question-panel__collapsed-button \{\s*border-radius: inherit;/u);
  assert.match(styles, /\.questionnaire-card--collapsed \.chat-question-panel__collapsed-button:focus-visible \{\s*outline-offset: -2px;/u);
  assert.match(styles, /\.questionnaire-card__collapsed-copy > \* \{[^}]*text-overflow: ellipsis;[^}]*white-space: nowrap;/su);
});
