import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "vitest";
import { additionChange, BOT_SETUP_CHARACTERS, buildExport, changeGroups, picksWithoutAddition, setupDocument, withAdditions } from "./export-format.ts";
import { BOT_LIMITS } from "../bots-format.ts";

test("building an export matches the portable fixture", async () => {
  const fixture = JSON.parse(await readFile(new URL("./export-format.fixture.json", import.meta.url), "utf8"));
  for (const item of fixture.changeGroups) assert.deepEqual(changeGroups(item.input), item.expected, item.input);
  for (const item of fixture.additions) assert.deepEqual(additionChange(fixture.review, item.input, "a9"), item.expected, item.input.quote);
  for (const item of fixture.picksWithoutAddition) assert.deepEqual(picksWithoutAddition(item.input.picks, item.input.index), item.expected);
  for (const item of fixture.builds) assert.deepEqual(buildExport(withAdditions(fixture.review, item.input.additions), item.input.picks), item.expected);
});

test("a template's setup document says what to give it, what to agree and what its schedules need", () => {
  const { text: doc, dropped } = setupDocument({
    name: "Ada",
    title: "Review helper",
    description: "Reviews pull requests.",
    open: [
      { kind: "ask", where: "SOUL.md", question: "Which repository?" },
      { kind: "confirm", where: "Trigger “Reviews”", question: "Approve when the checks pass?", excerpt: "approve when checks pass", operator: true },
    ],
    needs: ["the gh CLI, signed in"],
    routines: [{ name: "Daily digest", schedule: { kind: "cron", expression: "0 8 * * *" } }],
    triggers: [{ name: "Reviews" }],
    onboarding: "Ask them what to watch first.",
  });
  assert.match(doc, /^# Setting up Ada\n/u);
  assert.match(doc, /## What it does\n\nReview helper — Reviews pull requests\./u);
  assert.match(doc, /\n- Ask, in SOUL\.md: Which repository\?\n/u);
  assert.match(doc, /\n- Agree, in Trigger “Reviews” \(only they can change it\): Approve when the checks pass\? “approve when checks pass”\n/u);
  assert.match(doc, /\n- the gh CLI, signed in\n/u);
  assert.match(doc, /- Routine “Daily digest”, on `cron 0 8 \* \* \*` \(no time zone came with it: it runs in yours\): check the time on its Routines page, then turn it on\./u);
  assert.match(doc, /- Trigger “Reviews”: check what wakes it on its Triggers page, then turn it on\./u);
  assert.match(doc, /## What the previous owner wrote\n\nTheir own onboarding body came with it:\n\nAsk them what to watch first\./u);
  assert.match(doc, /## How to run this\n\nYou are that bot, newly imported/u);
  assert.deepEqual(dropped, [], "everything fits, so nothing is left out");
});

test("a setup document that runs long leaves points out and counts them, never cuts one", () => {
  const open = Array.from({ length: 60 }, (_, index) => ({ kind: "ask" as const, where: "SOUL.md", question: `Question ${index} ${"x".repeat(200)}?` }));
  const { text: doc, dropped } = setupDocument({ name: "Ada", open, needs: [], routines: [], triggers: [] });
  assert.ok(doc.length <= BOT_SETUP_CHARACTERS, `${doc.length} characters`);
  assert.match(doc, /\n[1-9]\d* items were left out to keep this short/u);
  for (const line of doc.split("\n").filter((each) => each.startsWith("- Ask, in"))) assert.match(line, /\?$/u);
  assert.equal(dropped.length, 60 - doc.split("\n").filter((each) => each.startsWith("- Ask, in")).length, "the dialog is told which ones");
  assert.match(dropped[0]!, /^Open point in SOUL\.md: Question /u);
});

test("a setup document no longer than a bot's BOOTSTRAP.md gives up the previous owner's body first, never an open point", () => {
  const body = Array.from({ length: 200 }, (_, index) => `Line ${index}: the previous owner's ritual, step by step.`).join("\n");
  const { text: doc, dropped } = setupDocument({
    name: "Ada", open: [{ kind: "ask", where: "SOUL.md", question: "Which repository?" }], needs: ["the gh CLI, signed in"], routines: [], triggers: [], onboarding: body,
  });
  assert.ok(doc.length <= BOT_SETUP_CHARACTERS, `${doc.length} characters`);
  assert.match(doc, /\n- Ask, in SOUL\.md: Which repository\?\n/u, "the setup itself stays");
  assert.match(doc, /\n- the gh CLI, signed in\n/u);
  assert.doesNotMatch(doc, /## What the previous owner wrote/u, "the body goes whole, never cut");
  assert.deepEqual(dropped, [`The previous owner's onboarding body (${body.length.toLocaleString("en-US")} characters)`]);
});

test("a template that needs nothing still says so and how to run it", () => {
  const { text: doc } = setupDocument({ name: "Ada", open: [], needs: [], routines: [], triggers: [] });
  assert.doesNotMatch(doc, /## What it needs from you|## Before it can run|## Its routines and triggers|## What it does\n/u);
  assert.match(doc, /## What it doesn't know about you/u);
  assert.match(doc, /## How to run this/u);
});

test("a build says how full its setup is and what it left out, and never writes more than a bot's BOOTSTRAP.md holds", async () => {
  const fixture = JSON.parse(await readFile(new URL("./export-format.fixture.json", import.meta.url), "utf8"));
  const body = "The previous owner's ritual, step by step. ".repeat(300);
  const review = { ...fixture.review, parts: [...fixture.review.parts, { id: "BOOTSTRAP.md", label: "BOOTSTRAP.md", kind: "text", fields: [{ key: "text", text: body }], read: true }] };
  const build = buildExport(review, {});
  assert.equal(build.setup.limit, BOT_LIMITS.bootstrap, "the import keeps it as the new bot's own BOOTSTRAP.md");
  assert.equal(BOT_SETUP_CHARACTERS, BOT_LIMITS.bootstrap);
  assert.ok(build.setup.characters <= build.setup.limit, `${build.setup.characters} characters`);
  assert.equal(build.setup.dropped.length, 1);
  assert.match(build.setup.dropped[0]!, /^The previous owner's onboarding body \([\d,]+ characters\)$/u);
  assert.equal(build.files[0]!.path, "BOOTSTRAP.md");
  assert.equal(build.files[0]!.text.length, build.setup.characters + 1, "the dialog's characters are the file without its last line break");
});
