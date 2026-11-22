/** Options → Create Jira task… files a local backlog task in Jira, prefilling the new work item from the task and attaching the created key to its card (BOARD-023). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

const call = (name: string, input: unknown) => `E2E_CALL:${Buffer.from(JSON.stringify({ name, input })).toString("base64url")}`;

test("Create Jira task… from a local task opens Create Jira work item from the backlog task, prefilled from it with a suggested parent, and the created key lands on the same card", { tags: ["BOARD-023"], platforms: ["web"] }, async ({ screen, hui }) => {
  const world = await hui.world("jira");
  const problem = "The backlog has nothing to file in Jira.";
  const fix = "File it from its card and read the key it gains.";
  const source = await world.createSession({ title: "Filing task source" });
  await world.prompt(source, call("suggest_task", { title: "Filing task", problem, fix }));
  await hui.open(`${world.url}/sessions/${source.id}`);
  await screen.getByRole("button", "More filing options").tap();
  await screen.getByText("Add to backlog", { visible: true }).tap();
  await expect(screen.getByText("Added “Filing task” to the Kanban backlog.")).toBeVisible();

  await hui.open(`${world.url}/kanban`);
  const board = screen.getByLabel("Kanban board");
  await board.getByRole("button", { name: "Options for Filing task" }).tap();
  await screen.getByLabel("Options for Filing task").getByText("Create Jira task…", { visible: true }).tap();

  const dialog = screen.getByRole("dialog", { name: "Create Jira work item" });
  await expect(dialog.getByText("From the backlog task “Filing task”.")).toBeVisible();
  // The task's own words are the draft: the summary is its title, the description its problem and fix.
  await expect(dialog.getByRole("textbox", { name: "Summary" })).toHaveValue("Filing task");
  await expect(dialog.getByRole("textbox", { name: /^Description/u }))
    .toHaveValue(`## Problem\n\n${problem}\n\n## Proposed fix\n\n${fix}`);
  // A parent is offered and marked as the model's choice.
  await expect(dialog.getByText("suggested", { exact: true })).toBeVisible();
  await expect(dialog.getByText(/^Drafted by .+\. Review before creating\.$/u)).toBeVisible();

  await dialog.getByRole("button", "Create", { exact: true }).tap();
  await expect(dialog).toBeHidden();
  await expect(screen.getByText("Created Jira work item CI-41 for the backlog task.")).toBeVisible();
  // The same card now carries what was filed, and stops offering to file it.
  const chip = board.getByRole("link", { name: "Jira CI-41, to do: Filing task" });
  await expect(chip).toHaveCount(1);
  await expect(chip).toBeVisible();
  await board.getByRole("button", { name: "Options for Filing task" }).tap();
  await expect(screen.getByLabel("Options for Filing task").getByText("Create Jira task…")).toBeHidden();
});
