/** Filing a suggested task instead of starting it: to the Kanban backlog as a local task, and into a new worktree on a
 * branch named with the configured prefix (AGENT-051, AGENT-048). */
import { basename } from "node:path";
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

const SUGGESTION = {
  title: "Replace the native terminal switcher select",
  problem: "The terminal pane header in `src/components/terminal-pane.ts` still switches terminals with a native `<select>`.\n\nIt looks different from every other HUI picker.",
  fix: "Render the switcher with `renderPicker` from `src/views/settings-picker.ts`.",
};

const suggest = (suggestion: Record<string, unknown>) =>
  `E2E_CALL:${Buffer.from(JSON.stringify({ name: "suggest_task", input: suggestion })).toString("base64url")}`;

test("Add to backlog tells the operator it landed, removes the card, and the board's Backlog holds it as a local task", { tags: ["AGENT-051"], platforms: ["web"] }, async ({ screen, hui }) => {
  const card = screen.getByRole("article", { name: SUGGESTION.title });
  const board = screen.getByLabel("Kanban board");
  // Without Jira the card's one filing action is its own button.
  const session = await hui.createSession({ title: "Filed to the backlog" });
  await hui.open(`/sessions/${session.id}`);
  await hui.prompt(session, suggest(SUGGESTION));
  await expect(card).toBeVisible();
  await expect(card.getByRole("button", "More filing options")).toBeHidden();
  await expect(card.getByRole("button", "Create Jira task")).toBeHidden();

  await card.getByRole("button", "Add to backlog").tap();
  await expect(screen.getByText(`Added “${SUGGESTION.title}” to the Kanban backlog.`)).toBeVisible();
  await expect(card).toBeHidden();

  // The board's Backlog keeps it as a local task with its problem's first line and the conversation's directory.
  await hui.open("/kanban");
  const filed = board.getByRole("button", { name: `${SUGGESTION.title}, local task. Start a session` });
  await expect(filed).toBeVisible();
  await expect(board.getByText("Local task").first()).toBeVisible();
  await expect(board.getByText(/^The terminal pane header in src\/components\/terminal-pane\.ts still switches/u)).toBeVisible();
  await expect(board.getByText(basename(hui.workspace)).first()).toBeVisible();
});

test("Start in a new worktree creates a checkout on a branch with the configured prefix, opens the card as its first turn and removes it", { tags: ["AGENT-048"], platforms: ["web"] }, async ({ screen, hui }) => {
  const card = screen.getByRole("article", { name: SUGGESTION.title });
  const transcript = screen.getByTestId("transcript");
  const repo = await hui.repository();
  // The branch name comes from HUI's utility model, as a worktree started from the board gets its own.
  const settings = await hui.api<{ branchPrefix: string; models: Record<string, unknown> }>("GET", "/__hui/settings");
  await hui.api("PUT", "/__hui/settings", { ...settings, models: { ...settings.models, utility: "hui-e2e/fixture" } });

  const session = await hui.createSession({ title: "Worktree from a suggestion", cwd: repo.path });
  await hui.open(`/sessions/${session.id}`);
  await hui.prompt(session, suggest(SUGGESTION));
  await expect(card).toBeVisible();

  await card.getByRole("button", "More start options").tap();
  await screen.getByRole("menuitem", { name: "Start in a new worktree" }).tap();

  // The new conversation opens on the card's prompt, in a checkout of its own.
  await expect(screen.getByTestId("session-title").filter({ hasText: SUGGESTION.title })).toBeVisible();
  await expect.poll(() => hui.url()).not.toContain(`/sessions/${session.id}`);
  await expect(transcript.getByText("# Replace the native terminal switcher select ## Problem", { exact: false })).toBeVisible();
  await expect(transcript.getByText("## Proposed fix Render the switcher with `renderPicker` from `src/views/settings-picker.ts`.", { exact: false })).toBeVisible();
  const created = (await hui.api<{ groups: { sessions: { id: string; title: string; cwd: string }[] }[] }>("GET", "/__hui/sessions"))
    .groups.flatMap(({ sessions }) => sessions).find((row) => row.title === SUGGESTION.title);
  expect(created?.cwd).not.toBe(repo.path);
  const worktrees = repo.git("worktree", "list", "--porcelain");
  expect(worktrees).toContain(`worktree ${created!.cwd}`);
  const branch = /^branch refs\/heads\/(.+)$/mu.exec(worktrees)?.[1];
  expect(branch?.startsWith(settings.branchPrefix)).toBe(true);

  // The card is gone from the conversation it came from.
  await hui.open(`/sessions/${session.id}`);
  await expect(screen.getByRole("article")).toHaveCount(0);
});
