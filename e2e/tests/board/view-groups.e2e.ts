/** View → Group by switches the board's lanes between project, custom groups and none, backlog items follow their group's lane or directory's project, the choice is kept by the browser, and Reset view restores every default (BOARD-012). */
import { basename } from "node:path";
import { expect, type Screen } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";

const call = (name: string, input: unknown) => `E2E_CALL:${Buffer.from(JSON.stringify({ name, input })).toString("base64url")}`;

const backlogItem = async (screen: Screen, hui: Hui, title: string, cwd?: string) => {
  const source = await hui.createSession({ title: `${title} source` });
  await hui.prompt(source, call("suggest_task", { title, problem: `${title} needs a look.`, ...(cwd ? { cwd } : {}) }));
  await hui.open(`/sessions/${source.id}`);
  await screen.getByRole("button", "Add to backlog").tap();
  await expect(screen.getByText(`Added “${title}” to the Kanban backlog.`)).toBeVisible();
};

const view = async (screen: Screen, choice: string) => {
  await screen.getByRole("button", "Board options").tap();
  await screen.getByLabel("Board options").first().getByText(choice, { visible: true }).tap();
};

test("Group by switches lanes between project, custom groups and none, backlog items follow their lane, the choice survives a reload and Reset view restores the defaults", { tags: ["BOARD-012"], platforms: ["web"] }, async ({ screen, hui }) => {
  const repo = await hui.repository();
  const workspace = basename(hui.workspace);
  const project = basename(repo.path);
  await hui.createSession({ title: "Flat session" });
  await hui.createSession({ title: "Grouped session", group: "Alpha" });
  await hui.createSession({ title: "Repo session", cwd: repo.path });
  await backlogItem(screen, hui, "Workspace task");
  await backlogItem(screen, hui, "Repo task", repo.path);

  await hui.open("/kanban");
  const board = screen.getByLabel("Kanban board");
  const cell = (lane: string, stage: string) => board.getByLabel(`${lane}, ${stage}`);

  await expect(cell(workspace, "Investigation").getByText("Flat session")).toBeVisible();
  await expect(cell(project, "Investigation").getByText("Repo session")).toBeVisible();
  await expect(cell(workspace, "Backlog").getByText("Workspace task")).toBeVisible();
  await expect(cell(project, "Backlog").getByText("Repo task")).toBeVisible();
  await expect(board.getByLabel("ALPHA")).toBeHidden();

  await view(screen, "Custom groups");
  await expect(cell("ALPHA", "Investigation").getByText("Grouped session")).toBeVisible();
  await expect(cell("OTHER", "Investigation").getByText("Flat session")).toBeVisible();
  await expect(cell("OTHER", "Backlog").getByText("Repo task")).toBeVisible();
  await board.getByRole("button", "Options for Repo task").tap();
  await screen.getByLabel("Options for Repo task").getByText("ALPHA", { visible: true }).tap();
  await expect(screen.getByText("Moved Repo task to ALPHA.")).toBeVisible();
  await expect(cell("ALPHA", "Backlog").getByText("Repo task")).toBeVisible();
  await expect(cell("OTHER", "Backlog").getByText("Repo task")).toBeHidden();

  await view(screen, "None");
  await expect(board.getByLabel(workspace)).toBeHidden();
  await expect(board.getByLabel("Investigation").getByText("Grouped session")).toBeVisible();
  await expect(board.getByLabel("Investigation").getByText("Repo session")).toBeVisible();
  await expect(board.getByLabel("Backlog").getByText("Repo task")).toBeVisible();
  await expect(board.getByLabel("Backlog").getByText("Workspace task")).toBeVisible();

  await hui.reload();
  await expect(board.getByLabel(workspace)).toBeHidden();
  await expect(board.getByLabel("Investigation").getByText("Grouped session")).toBeVisible();

  await view(screen, "Done");
  await expect(board.getByLabel("Done")).toBeHidden();
  await view(screen, "Reset view");
  await expect(cell(workspace, "Investigation").getByText("Flat session")).toBeVisible();
  await expect(cell(project, "Investigation").getByText("Repo session")).toBeVisible();
  await expect(cell(project, "Backlog").getByText("Repo task")).toBeVisible();
  for (const stage of ["Backlog", "Investigation", "Implementation", "Testing", "Done"]) {
    await expect(cell(project, stage)).toBeVisible();
  }
  await expect(cell(workspace, "Backlog").getByText("Workspace task", { exact: true })).toBeVisible();
  await expect(cell(workspace, "Investigation").getByText("Grouped session")).toBeVisible();
});
