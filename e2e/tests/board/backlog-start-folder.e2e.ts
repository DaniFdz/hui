/** Start session on a folder outside Git ends the form with a note and Start enabled, and switching folders resets the later steps (BOARD-026). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

const call = (name: string, input: unknown) => `E2E_CALL:${Buffer.from(JSON.stringify({ name, input })).toString("base64url")}`;

test("a folder outside Git ends the form with Not a Git repository and Start session enabled, and switching folders resets the branch and worktree steps", { tags: ["BOARD-026"], platforms: ["web"] }, async ({ screen, hui }) => {
  const repo = await hui.repository();
  const source = await hui.createSession({ title: "Folder switch source" });
  await hui.prompt(source, call("suggest_task", { title: "Folder switch task", problem: "The folder steps need a look." }));
  await hui.open(`/sessions/${source.id}`);
  await screen.getByRole("button", "Add to backlog").tap();
  await expect(screen.getByText("Added “Folder switch task” to the Kanban backlog.")).toBeVisible();

  await hui.open("/kanban");
  await screen.getByLabel("Kanban board").getByRole("button", "Folder switch task, local task. Start a session").tap();
  const folder = screen.getByPlaceholder("~/");
  const start = screen.getByRole("button", "Start session", { visible: true });
  const suffix = screen.getByText("Branch suffix");
  const branch = screen.getByRole("button", "Branch: main");

  const plain = screen.getByText("Not a Git repository; the session works in this folder as it is.");
  await expect(plain).toBeVisible();
  await expect(start).toBeEnabled();
  await expect(branch).toBeHidden();

  await folder.fill(repo.path);
  await expect(branch).toBeVisible();
  await expect(plain).toBeHidden();
  await expect(suffix).toBeHidden();

  await screen.getByText("New worktree", { visible: true }).tap();
  await expect(suffix).toBeVisible();

  await folder.fill(hui.workspace);
  await expect(plain).toBeVisible();
  await expect(suffix).toBeHidden();

  await folder.fill(repo.path);
  await expect(branch).toBeVisible();
  await expect(suffix).toBeHidden();
  await expect(start).toBeEnabled();
});
