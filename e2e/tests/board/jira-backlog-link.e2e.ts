/** Options → Link existing Jira work item… links a local backlog task to the chosen work item, which the card then carries instead of offering to link one (BOARD-024). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

const call = (name: string, input: unknown) => `E2E_CALL:${Buffer.from(JSON.stringify({ name, input })).toString("base64url")}`;

test("Link existing Jira work item… links a local task to the chosen work item and the card keeps one entry, now with that key, and offers to link another no more", { tags: ["BOARD-024"], platforms: ["web"] }, async ({ screen, hui }) => {
  const world = await hui.world("jira");
  const source = await world.createSession({ title: "Link task source" });
  await world.prompt(source, call("suggest_task", { title: "Linkable task", problem: "A local task with no Jira key.", fix: "Link it to a work item." }));
  await hui.open(`${world.url}/sessions/${source.id}`);
  // With Jira connected, saving a task is the second filing option.
  await screen.getByRole("button", "More filing options").tap();
  await screen.getByText("Add to backlog", { visible: true }).tap();
  await expect(screen.getByText("Added “Linkable task” to the Kanban backlog.")).toBeVisible();

  await hui.open(`${world.url}/kanban`);
  const board = screen.getByLabel("Kanban board");
  const options = () => screen.getByLabel("Options for Linkable task");
  await board.getByRole("button", "Options for Linkable task").tap();
  await options().getByText("Link existing Jira work item…", { visible: true }).tap();

  const dialog = screen.getByRole("dialog", { name: "Link Jira work item" });
  await expect(dialog.getByText("To “Linkable task”.")).toBeVisible();
  const search = dialog.getByRole("combobox", { name: "Search Jira work items" });
  await search.fill("CI-2");
  await dialog.getByRole("option").filter({ hasText: "Developer tooling polish" }).tap();
  await expect(dialog).toBeHidden();
  await expect(screen.getByText("Linked Jira work item CI-2 to the backlog task.")).toBeVisible();

  // One card, one work item: the entry it had is now the linked one.
  const chip = board.getByRole("link", { name: /^Jira CI-2, /u });
  await expect(chip).toHaveCount(1);
  await expect(chip).toBeVisible();
  await expect(board.getByRole("button", "Linkable task, local task. Start a session")).toBeVisible();

  await board.getByRole("button", "Options for Linkable task").tap();
  await expect(options().getByText("Link existing Jira work item…")).toBeHidden();
  await expect(options().getByText("Create Jira task…")).toBeHidden();
  await expect(options().getByText("Open in Jira · CI-2", { exact: true, visible: true })).toBeVisible();
  await expect(chip).toHaveCount(1);
});
