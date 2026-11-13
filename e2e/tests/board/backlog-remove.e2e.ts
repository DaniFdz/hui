/** Remove from backlog… asks before deleting a local task, Cancel keeps it, and Remove deletes it with a notice (BOARD-022). */
import { expect } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";

const call = (name: string, input: unknown) => `E2E_CALL:${Buffer.from(JSON.stringify({ name, input })).toString("base64url")}`;

const backlogTitles = async (hui: Hui) =>
  (await hui.api<{ items: { title: string }[] }>("GET", "/__hui/backlog")).items.map((item) => item.title);

test("Remove from backlog… asks first, Cancel keeps the task, and Remove deletes it and says so", { tags: ["BOARD-022"], platforms: ["web"] }, async ({ screen, hui }) => {
  const source = await hui.createSession({ title: "Removable task source" });
  await hui.prompt(source, call("suggest_task", { title: "Removable task", problem: "Removable task needs a look." }));
  await hui.open(`/sessions/${source.id}`);
  await screen.getByRole("button", "Add to backlog").tap();
  await expect(screen.getByText("Added “Removable task” to the Kanban backlog.")).toBeVisible();

  await hui.open("/kanban");
  const board = screen.getByLabel("Kanban board");
  const dialog = screen.getByRole("dialog", { name: "Remove “Removable task” from the backlog?" });
  const options = async () => {
    await board.getByRole("button", "Options for Removable task").tap();
    await screen.getByLabel("Options for Removable task").getByText("Remove from backlog…", { visible: true }).tap();
  };
  await expect(board.getByText("Removable task")).toBeVisible();

  await options();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("The local task and its problem and fix notes are deleted.")).toBeVisible();
  await dialog.getByRole("button", "Cancel").tap();
  await expect(dialog).toBeHidden();
  await expect(board.getByText("Removable task")).toBeVisible();
  expect(await backlogTitles(hui)).toContain("Removable task");

  await options();
  await dialog.getByRole("button", "Remove").tap();
  await expect(screen.getByText("Removed “Removable task” from the backlog.")).toBeVisible();
  await expect(dialog).toBeHidden();
  await expect(board.getByText("Removable task")).toBeHidden();
  expect(await backlogTitles(hui)).not.toContain("Removable task");

  await hui.reload();
  await expect(board.getByText("Removable task")).toBeHidden();
  expect(await backlogTitles(hui)).not.toContain("Removable task");
});
