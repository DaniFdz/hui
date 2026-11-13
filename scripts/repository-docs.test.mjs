/**
 * A plan, a goal, a status ledger or a roadmap describes one run: it goes stale, and every other run's copy conflicts
 * with it. Agents committed six of them at the root and three under `docs/` (the iOS plan, then the Android plan, the
 * roadmap and the visual goal) because a playbook told them to write one and nothing stopped it (see AGENTS.md,
 * "Repository state rules and what enforces them"). The plan belongs to the conversation; `work/` holds the scratch
 * files a run needs, and Git ignores it.
 *
 * This fails a committed plan document, so the next agent deletes the file instead of copying its format. Whether a
 * document is a plan by its content is a review matter; this checks where plans and ledgers arrive and what they are
 * called.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { dirname, posix } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";

const root = posix.join(dirname(fileURLToPath(import.meta.url)), "..");

function git(...args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

const tracked = git("ls-files", "-z").split("\0").filter(Boolean);

/** The standard documents every contributor expects at the root; anything else there is project-wide, not a task. */
const ROOT_DOCUMENTS = new Set([
  "AGENTS.md",
  "CONTRIBUTING.md",
  "README.md",
  "SECURITY.md",
  "SPEC.md",
  "THIRD_PARTY_NOTICES.md",
]);

/** Directories that own guidance: a skill or playbook may be named after planning without being a plan. */
const GUIDANCE = /^(?:\.agents|skills|staff)\//u;

/** `PLAN.md`, `GOAL-EXTENDABILITY.md`, `native-android-plan.md`, `visual-parity-goal.md`, `implementation-roadmap.md`. */
const PLAN_SHAPED = /(?:^|[-_.])(?:plans?|goals?|ledgers?|roadmaps?)(?:[-_.]|$)/iu;

/** A document's name; a module may be named after the feature it implements (`goals.ts`). */
const isDocument = (file) => file.endsWith(".md");

test("the repository root holds only the project's standard documents", () => {
  const extra = tracked.filter((file) => !file.includes("/") && file.endsWith(".md") && !ROOT_DOCUMENTS.has(file));
  assert.deepEqual(extra, [], "a root Markdown file is a project-wide contract, not a task's plan or notes: keep it in the conversation, or in work/ which Git ignores");
});

test("a plan, a goal, a ledger or a roadmap is not committed", () => {
  const found = tracked.filter((file) => isDocument(file) && !GUIDANCE.test(file) && PLAN_SHAPED.test(posix.basename(file)));
  assert.deepEqual(found, [], "keep the plan in the conversation and a run's scratch files in work/, which Git ignores; what ships goes into SPEC.md, docs/api.md and an e2e evidence note");
});

test("a run's scratch files under work/ stay out of Git", () => {
  assert.deepEqual(tracked.filter((file) => file.startsWith("work/")), [], "work/ holds a run's plan, ledger and decision log: never commit it");
  assert.doesNotThrow(() => git("check-ignore", "-q", "work/index.md"), "add `/work/` to .gitignore, so a run's scratch files never show up in git status");
});
