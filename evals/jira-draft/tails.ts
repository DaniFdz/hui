import type { TranscriptEntry } from "../../server/runtimes/types.ts";
import { assistant, bash, edit, user } from "./transcript.ts";

/**
 * Long, realistic session endings. Real sessions often spend their last dozens
 * of turns on cleanup unrelated to the goal; these builders produce that volume
 * without hand-writing every turn, so the goal falls outside any tail slice.
 */

const LINT_RULES: readonly [string, string][] = [
  ["import/order", "reordered imports: node builtins, packages, then local modules"],
  ["@typescript-eslint/no-unused-vars", "removed the unused binding after checking it has no references"],
  ["prefer-const", "changed let to const; the variable is never reassigned"],
  ["react-hooks/exhaustive-deps", "added the missing dependency and memoized the callback with useCallback"],
  ["@typescript-eslint/no-floating-promises", "awaited the promise and let errors propagate to the caller"],
  ["no-console", "replaced console.log with the structured logger at debug level"],
  ["jsx-a11y/click-events-have-key-events", "added an onKeyDown handler for Enter and Space mirroring onClick"],
  ["@typescript-eslint/consistent-type-imports", "switched to import type for type-only imports"],
];

const LINT_AREAS: readonly [string, readonly string[]][] = [
  ["billing", ["src/billing/invoice.ts", "src/billing/tax.ts", "src/billing/credit-notes.ts", "src/billing/currency.ts", "src/billing/proration.ts"]],
  ["dashboard UI", ["src/ui/Header.tsx", "src/ui/Sidebar.tsx", "src/ui/Table.tsx", "src/ui/DateRangePicker.tsx", "src/ui/Toast.tsx"]],
  ["accounts", ["src/accounts/signup.ts", "src/accounts/invite.ts", "src/accounts/roles.ts", "src/accounts/sso-settings.ts"]],
  ["scripts", ["scripts/seed.ts", "scripts/backfill-currencies.ts", "scripts/rotate-keys.ts", "scripts/report-usage.ts"]],
  ["search", ["src/search/indexer.ts", "src/search/query-parser.ts", "src/search/highlight.ts", "src/search/facets.ts"]],
  ["notifications", ["src/notifications/email.ts", "src/notifications/digest.ts", "src/notifications/preferences.ts", "src/notifications/templates.ts"]],
];

/** An ESLint upgrade fallout: rounds of lint fixes across unrelated code. */
export function lintCleanupTail(): TranscriptEntry[] {
  const entries: TranscriptEntry[] = [user("CI is red on lint, can you fix it?")];
  entries.push(assistant("The lint job fails with 71 errors after the ESLint v9 flat-config upgrade on main turned several rules from warn to error. Almost none are in the code this branch touched; they span billing, the dashboard UI, accounts, scripts, search and notifications. I'll go area by area and keep every fix mechanical."));
  LINT_AREAS.forEach(([area, files], areaIndex) => {
    const lines = files.flatMap((file, fileIndex) => [0, 1, 2].map((offset) => {
      const [rule, fix] = LINT_RULES[(areaIndex * 3 + fileIndex + offset) % LINT_RULES.length]!;
      return "- " + file + ":" + (12 + fileIndex * 31 + offset * 7) + " " + rule + ": " + fix + ".";
    }));
    entries.push(bash("npx eslint " + files.join(" "), files.length * 3 + " problems"));
    for (const file of files) entries.push(edit(file));
    entries.push(assistant("Fixed the " + area + " errors:\n\n" + lines.join("\n") + "\n\nRe-ran eslint on these files: clean. Type-check still passes."));
    if (areaIndex % 2 === 1) entries.push(user("ok, keep going, there are still errors in the CI log"));
  });
  entries.push(user("also the snapshot test in ui/Header.test.tsx is flaky, it failed twice today"));
  entries.push(edit("src/ui/Header.test.tsx"));
  entries.push(assistant("Header renders 'Last synced 3 minutes ago' from Date.now(), so the snapshot changes when the test crosses a minute boundary or runs slowly on CI. I mocked the clock with vi.useFakeTimers() and vi.setSystemTime(new Date('2026-01-01T12:00:00Z')) in beforeEach, restored real timers in afterEach and regenerated the snapshot. 200 repeated runs pass. Sidebar.test.tsx and Footer.test.tsx don't touch the clock."));
  entries.push(user("thanks, lint is green now and the header test passes"));
  entries.push(assistant("Great. All 71 lint errors are fixed and the Header snapshot flake is gone, so CI is green on the branch. If the ESLint v9 upgrade keeps surfacing errors on other branches, a small follow-up to clear the remaining warnings on main in one go would help."));
  return entries;
}

const CSS_ROUNDS: readonly [string, string, string][] = [
  ["The Sign in with SSO button looks off on mobile, it's not aligned with the password form and the spacing is weird", ".login-card", "display: grid;\n  grid-template-columns: 1fr;\n  gap: 16px;\n  padding: 24px 20px;"],
  ["better, but the icon inside the button is a bit too big and the text isn't centered vertically", ".sso-button", "display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  gap: 8px;\n  height: 44px;\n  line-height: 1;"],
  ["can you make the divider text lighter?", ".login-divider span", "color: var(--text-muted);\n  font-size: 13px;\n  letter-spacing: 0.02em;"],
  ["the divider lines look thicker than the input borders", ".login-divider::before,\n.login-divider::after", "height: 1px;\n  background: var(--border-subtle);\n  transform: scaleY(0.5);"],
  ["on iPhone SE the card touches the screen edges", ".login-page", "padding-inline: max(16px, env(safe-area-inset-left));\n  min-height: 100dvh;"],
  ["the focus ring on the SSO button is cut off", ".sso-button:focus-visible", "outline: 2px solid var(--focus);\n  outline-offset: 2px;\n  position: relative;\n  z-index: 1;"],
  ["in dark mode the Okta logo disappears", ".sso-button svg", "width: 18px;\n  height: 18px;\n  color: currentColor;\n  flex: none;"],
  ["the error message under the password field jumps the layout when it appears", ".field-error", "min-height: 18px;\n  margin-top: 4px;\n  font-size: 13px;"],
  ["can the forgot password link line up with the right edge of the input?", ".password-row", "display: flex;\n  justify-content: space-between;\n  align-items: baseline;"],
  ["the whole card feels a bit cramped on desktop", "@media (min-width: 768px) {\n  .login-card", "max-width: 420px;\n  padding: 32px;\n  gap: 20px;\n}"],
];

/** Pixel-level styling iterations on a login page. */
export function stylingTail(): TranscriptEntry[] {
  return CSS_ROUNDS.flatMap(([ask, selector, rules], index) => [
    user(ask),
    edit("web/login/LoginCard.css"),
    assistant("Adjusted the styles (round " + (index + 1) + "):\n\n~~~css\n" + selector + " {\n  " + rules + "\n}\n~~~\n\nChecked at 320, 375 and 414px widths and at 1280px, in light and dark themes. Nothing else on the page moved; the password form keeps its existing spacing and the touch targets stay at least 44px tall."),
  ]);
}

const CI_FAILURES: readonly [string, string][] = [
  ["the e2e job", "an older test, e2e/settings.spec.ts, asserted the heading color, which differs on the CI runner because it reports prefers-color-scheme: dark. I switched it to assert role and text and pinned colorScheme: 'light' for the legacy suites in playwright.config.ts"],
  ["the visual regression job", "the baseline screenshots were taken before the token changes, so every page diffed by a few pixels of border color. I regenerated the baselines in the CI container (not locally, to avoid font rendering differences) and committed them"],
  ["the unit job on Node 20", "structuredClone of a MediaQueryList mock throws on Node 20 but not 22. The ThemeProvider test now builds the mock with a plain object and an addEventListener stub"],
  ["the bundle size check", "the dark token set added 3.1 KB to the main CSS bundle, over the 2 KB budget. I moved the token sets into a separate theme.css loaded with media queries and a preload, which brings the increase to 0.4 KB"],
  ["the e2e job again, only on WebKit", "WebKit fires the matchMedia change event before localStorage writes are visible in a second tab, so the cross-tab test was racing. The test now waits for the storage event instead of a timeout"],
];

/** Repeated CI failures after a pull request is opened. */
export function ciFailuresTail(): TranscriptEntry[] {
  return [
    user("commit it and open a PR"),
    bash("gh pr create --fill", "https://git.example.test/web/pull/214"),
    assistant("Committed as 'feat(settings): add light/dark/system theme toggle' and opened pull request #214 with screenshots of both themes, the test plan and the filled-in checklist."),
    ...CI_FAILURES.flatMap(([job, cause]) => [
      user("CI failed on " + job),
      edit("e2e/settings.spec.ts"),
      bash("git push", ""),
      assistant("Looked at the CI log for " + job + ". The cause: " + cause + ". Pushed the fix to the pull request branch and the rerun of that job is green; the other jobs were already passing, so nothing else needed to change on the PR."),
    ]),
    user("nice, merge it when it's approved"),
    assistant("Will do. PR #214 is green and waiting for review; I'll squash-merge it once approved and delete the branch."),
  ];
}

const GIT_QUESTIONS: readonly [string, string][] = [
  ["btw unrelated, how do I rebase my branch onto main without losing my local uncommitted changes?", "Let Git stash for you: git fetch origin, then git rebase --autostash origin/main. It stashes uncommitted changes, rebases and reapplies them; on a conflict the stash is kept so nothing is lost. Manually: git stash push -u, git fetch origin, git rebase origin/main, resolve conflicts with git add and git rebase --continue, then git stash pop. git rebase --abort restores the branch, and git reflog shows every previous position. git config --global rebase.autoStash true makes this the default."],
  ["and how do I squash the last 3 commits into one?", "git rebase -i HEAD~3, keep the first line as pick and change the others to squash (or fixup to drop their messages). If the commits were pushed, follow with git push --force-with-lease, which refuses to overwrite someone else's newer commits. Non-interactive alternative: git reset --soft HEAD~3 and one new git commit."],
  ["what's the difference between git merge --ff-only and a normal merge?", "--ff-only only succeeds when your branch can move forward to the other one without a merge commit, so history stays linear and the command fails instead of creating a merge. A normal merge fast-forwards when it can and otherwise creates a merge commit with two parents. --no-ff always creates a merge commit, even when a fast-forward is possible, which some teams use to record that a feature branch existed."],
  ["how do I undo a commit I already pushed?", "On a shared branch, use git revert <sha>: it creates a new commit that inverts the change, so nobody's history is rewritten. On your own branch you can git reset --hard <sha-before> and git push --force-with-lease. For a merge commit, git revert -m 1 <sha> keeps the first parent's side."],
  ["and how do I find which commit introduced a bug?", "git bisect start, git bisect bad (current commit), git bisect good <known-good-sha>. Git checks out the midpoint; test and mark it good or bad until it names the first bad commit. git bisect run <script> automates it when the script exits 0 for good and non-zero for bad. Finish with git bisect reset."],
  ["last one: how do I get one file back from another branch?", "git restore --source=<branch> -- path/to/file copies that file's version from the branch into your working tree without switching branches. Add --staged to stage it too. With older Git, git checkout <branch> -- path/to/file does the same."],
];

/** Side questions about Git, unrelated to the session's work. */
export function gitQuestionsTail(): TranscriptEntry[] {
  return GIT_QUESTIONS.flatMap(([question, answer]) => [user(question), assistant(answer)]);
}
