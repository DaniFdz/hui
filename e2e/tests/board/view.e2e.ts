/** The board's View menu chooses which sessions, columns and lanes it shows (BOARD-013, BOARD-014). */
import { basename } from "node:path";
import { expect, type Screen } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";

const call = (name: string, input: unknown) => `E2E_CALL:${Buffer.from(JSON.stringify({ name, input })).toString("base64url")}`;
const COLUMNS = ["Backlog", "Investigation", "Implementation", "Testing", "Done"];

const backlogTask = async (screen: Screen, hui: Hui, title: string) => {
  const source = await hui.createSession({ title: `${title} source` });
  await hui.prompt(source, call("suggest_task", { title, problem: `${title} needs a look.` }));
  await hui.open(`/sessions/${source.id}`);
  await screen.getByRole("button", "Add to backlog").tap();
  await expect(screen.getByText(`Added “${title}” to the Kanban backlog.`)).toBeVisible();
};

const view = async (screen: Screen, choice: string) => {
  await screen.getByRole("button", "Board options").tap();
  await screen.getByLabel("Board options").first().getByText(choice, { visible: true }).tap();
};

test("View → Status shows active, archived or all sessions with backlog items outside Archived, and Show subagent sessions adds child sessions", { tags: ["BOARD-013"], platforms: ["web"] }, async ({ screen, hui }) => {
  await backlogTask(screen, hui, "Status backlog task");
  const parent = await hui.createSession({ title: "Status parent" });
  const child = await hui.createSubagent(parent);
  const archived = await hui.createSession({ title: "Status archived" });
  await hui.api("PATCH", `/__hui/sessions/${archived.id}`, { archived: true });
  await hui.open("/kanban");
  const board = screen.getByLabel("Kanban board");
  const workspace = basename(hui.workspace);

  await expect(board.getByLabel(`${workspace}, Investigation`).getByText("Status parent")).toBeVisible();
  await expect(board.getByLabel(`${workspace}, Backlog`).getByText("Status backlog task")).toBeVisible();
  await expect(board.getByText("Status archived")).toBeHidden();
  await expect(board.getByText(child.title)).toBeHidden();

  await view(screen, "Archived");
  await expect(board.getByText("Status archived")).toBeVisible();
  await expect(board.getByText("Status parent")).toBeHidden();
  await expect(board.getByText("Status backlog task")).toBeHidden();

  await view(screen, "All");
  await expect(board.getByText("Status archived")).toBeVisible();
  await expect(board.getByText("Status parent")).toBeVisible();
  await expect(board.getByText("Status backlog task")).toBeVisible();

  await view(screen, "Show subagent sessions");
  await expect(board.getByText(child.title)).toBeVisible();
  await view(screen, "Show subagent sessions");
  await expect(board.getByText("Status parent")).toBeVisible();
  await expect(board.getByText(child.title)).toBeHidden();
});

test("View → Columns toggles each column and turning off the last brings them all back, and Hide empty lanes chooses when empty lanes go", { tags: ["BOARD-014"], platforms: ["web"] }, async ({ screen, hui }) => {
  await hui.createSession({ title: "Columns card" });
  await hui.open("/kanban");
  const board = screen.getByLabel("Kanban board");
  const workspace = basename(hui.workspace);
  const cell = (stage: string, lane = workspace) => board.getByLabel(`${lane}, ${stage}`);
  await expect(cell("Investigation").getByText("Columns card")).toBeVisible();

  await view(screen, "Testing");
  await expect(cell("Done")).toBeVisible();
  await expect(cell("Testing")).toBeHidden();
  for (const column of ["Backlog", "Investigation", "Implementation", "Done"]) await view(screen, column);
  for (const column of COLUMNS) await expect(cell(column)).toBeVisible();
  await view(screen, "Done");
  await expect(cell("Testing")).toBeVisible();
  await expect(cell("Done")).toBeHidden();
  await view(screen, "Done");
  await expect(cell("Done")).toBeVisible();

  await hui.api("POST", "/__hui/session-groups", { name: "Empty lane" });
  await view(screen, "Custom groups");
  await expect(cell("Investigation", "OTHER").getByText("Columns card")).toBeVisible();
  await expect(cell("Investigation", "EMPTY LANE")).toBeVisible();
  const filter = screen.getByPlaceholder("Filter cards…");
  await filter.fill("Columns card");
  await expect(cell("Investigation", "OTHER").getByText("Columns card")).toBeVisible();
  await expect(board.getByLabel("EMPTY LANE")).toBeHidden();
  await view(screen, "Never");
  await expect(cell("Investigation", "EMPTY LANE")).toBeVisible();
  await filter.fill("");
  await view(screen, "Always");
  await expect(cell("Investigation", "OTHER").getByText("Columns card")).toBeVisible();
  await expect(board.getByLabel("EMPTY LANE")).toBeHidden();
  await view(screen, "When filtering");
  await expect(cell("Investigation", "EMPTY LANE")).toBeVisible();
});
