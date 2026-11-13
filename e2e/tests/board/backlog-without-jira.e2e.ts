/** Without a Jira connection the Backlog lists local tasks with the note that says how to connect, and the board stays usable (BOARD-018). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

const call = (name: string, input: unknown) => `E2E_CALL:${Buffer.from(JSON.stringify({ name, input })).toString("base64url")}`;

test("without a Jira connection the Backlog shows local tasks and the Connect Jira note instead of an error, and the board stays usable", { tags: ["BOARD-018"], platforms: ["web"] }, async ({ screen, hui }) => {
  const source = await hui.createSession({ title: "Local task source" });
  await hui.prompt(source, call("suggest_task", { title: "Local only task", problem: "Local only task needs a look." }));
  await hui.open(`/sessions/${source.id}`);
  await screen.getByRole("button", "Add to backlog").tap();
  await expect(screen.getByText("Added “Local only task” to the Kanban backlog.")).toBeVisible();
  await hui.createSession({ title: "Usable card" });
  expect((await hui.api<{ jira: { status: string } }>("GET", "/__hui/backlog")).jira.status).toBe("unconfigured");

  await hui.open("/kanban");
  const board = screen.getByLabel("Kanban board");
  await expect(board.getByLabel("Backlog", { exact: false }).getByText("Local only task")).toBeVisible();
  await expect(screen.getByText("Connect Jira in Settings → Integrations to list the work items assigned to you.")).toBeVisible();
  await expect(screen.getByRole("alert")).toBeHidden();
  await expect(board.getByText("Usable card")).toBeVisible();

  await screen.getByRole("button", "Refresh").tap();
  await expect(board.getByText("Local only task")).toBeVisible();
  await expect(screen.getByText("Connect Jira in Settings → Integrations to list the work items assigned to you.")).toBeVisible();

  await screen.getByPlaceholder("Filter cards…").fill("Usable card");
  await expect(board.getByText("Usable card")).toBeVisible();
  await expect(board.getByText("Local only task")).toBeHidden();
  await screen.getByPlaceholder("Filter cards…").fill("");
  await expect(board.getByText("Local only task")).toBeVisible();
});
