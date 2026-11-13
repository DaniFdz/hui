/** A suggested task filed in Jira: the card's own Create Jira task, the dialog it opens already carrying the card's
 * title and details and linked to the conversation, and the work item it files (AGENT-052). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

const SUGGESTION = {
  title: "Surface flaky CI failures instead of retrying silently",
  problem: "The retry wrapper in `ci/run.sh` hides flaky failures.\n\n- Surface the first failure\n- Keep one retry for network errors",
  fix: "Report the original error and log every retry with its cause.",
};

const suggest = (suggestion: Record<string, unknown>) =>
  `E2E_CALL:${Buffer.from(JSON.stringify({ name: "suggest_task", input: suggestion })).toString("base64url")}`;

test("with Jira connected, Create Jira task opens a dialog carrying the card's title and details and files it", { tags: ["AGENT-052"], platforms: ["web"] }, async ({ screen, hui }) => {
  // A world whose gateway has Jira connected, so the card offers Jira filing at all.
  const world = await hui.world("jira");
  const session = await world.createSession({ title: "Jira from a suggestion" });
  const card = screen.getByRole("article", { name: SUGGESTION.title });
  await hui.open(`${world.url}/sessions/${session.id}`);
  await world.prompt(session, suggest(SUGGESTION));
  await expect(card).toBeVisible({ timeout: 120_000 });

  // With Jira the card's primary filing action is Jira, with the backlog behind its own menu.
  await expect(card.getByRole("button", "Create Jira task")).toBeVisible();
  await expect(card.getByRole("button", "More filing options")).toBeVisible();
  await card.getByRole("button", "Create Jira task").tap();

  // The dialog is the card's own, linked to the conversation it came from.
  const dialog = screen.getByRole("dialog", { name: "Create Jira work item" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(`From a suggested task · linked to “Jira from a suggestion”.`)).toBeVisible();
  const summary = dialog.getByRole("textbox", { name: "Summary" });
  const description = dialog.getByRole("textbox", { name: /^Description/u });
  await expect.poll(() => summary.inputValue()).toBe(SUGGESTION.title);
  await expect.poll(() => description.inputValue())
    .toBe(`## Problem\n\n${SUGGESTION.problem}\n\n## Proposed fix\n\n${SUGGESTION.fix}`);

  // Create files it under the fixture's Jira key and the card is gone.
  const create = dialog.getByRole("button", "Create");
  await expect(create).toBeEnabled({ timeout: 60_000 });
  await create.tap();
  await expect(screen.getByText(/^Created Jira work item [A-Z]+-\d+\.$/u)).toBeVisible({ timeout: 60_000 });
  await expect(card).toBeHidden();
});
