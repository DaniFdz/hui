/** Start session from a backlog item: its title, Options → Start session… or a drop on a stage cell opens the dialog, which asks only for the folder first, and starting places the new session in that column with the task's problem and fix as its first prompt (BOARD-025). */
import { basename } from "node:path";
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

const call = (name: string, input: unknown) => `E2E_CALL:${Buffer.from(JSON.stringify({ name, input })).toString("base64url")}`;

type Row = { id: string; title: string; stage?: string; stageOrigin?: string };

test("a backlog item's title, Options → Start session… and a drop on a stage cell open Start session, which asks only for the folder first, and starting places the new session there with the task's problem and fix", { tags: ["BOARD-025"], platforms: ["web"] }, async ({ screen, hui }) => {
  const problem = "The start dialog has nothing to prove.";
  const fix = "Start the session from the task and read its first prompt.";
  const source = await hui.createSession({ title: "Start task source" });
  await hui.prompt(source, call("suggest_task", { title: "Started task", problem, fix }));
  await hui.open(`/sessions/${source.id}`);
  await screen.getByRole("button", "Add to backlog").tap();
  await expect(screen.getByText("Added “Started task” to the Kanban backlog.")).toBeVisible();

  await hui.open("/kanban");
  const board = screen.getByLabel("Kanban board");
  const lane = basename(hui.workspace);
  const item = board.getByRole("listitem").filter({ hasText: "Started task" });
  const dialog = screen.getByRole("dialog", { name: "Start session" });
  const start = screen.getByRole("button", "Start session", { visible: true });
  const folder = screen.getByPlaceholder("~/");
  const rows = async () => (await hui.api<{ groups: { sessions: Row[] }[] }>("GET", "/__hui/sessions")).groups.flatMap((group) => group.sessions);
  const backlogTitles = async () => (await hui.api<{ items: { title: string }[] }>("GET", "/__hui/backlog")).items.map((entry) => entry.title);

  await board.getByRole("button", "Started task, local task. Start a session").tap();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("“Started task” → Investigation · OTHER")).toBeVisible();
  await expect(folder).toHaveValue(hui.workspace);
  await expect(dialog.getByText("Not a Git repository; the session works in this folder as it is.")).toBeVisible();
  await expect(start).toBeEnabled();
  await folder.fill("");
  await expect(start).toBeDisabled();
  await folder.fill(hui.workspace);
  await expect(start).toBeEnabled();
  // The folder's suggestions are open after typing; a tap elsewhere closes them so the next tap reaches the dialog's control.
  await dialog.getByText("“Started task” → Investigation · OTHER").tap();
  await dialog.getByRole("button", "Cancel").tap();
  await expect(dialog).toBeHidden();

  await board.getByRole("button", "Options for Started task").tap();
  await screen.getByLabel("Options for Started task").getByText("Start session…", { visible: true }).tap();
  await expect(dialog.getByText("“Started task” → Investigation · OTHER")).toBeVisible();
  await dialog.getByText("“Started task” → Investigation · OTHER").tap();
  await dialog.getByRole("button", "Cancel").tap();
  await expect(dialog).toBeHidden();

  await hui.drag(item, board.getByLabel(`${lane}, Testing`), async () => {});
  await expect(dialog.getByText("“Started task” → Testing · OTHER")).toBeVisible();
  await dialog.getByText("“Started task” → Testing · OTHER").tap();
  await start.tap();
  await expect(screen.getByText("Started “Started task” from the backlog in Testing.")).toBeVisible();
  await expect(dialog).toBeHidden();

  const started = (await rows()).find((row) => row.title === "Started task");
  expect(started?.stage).toBe("testing");
  expect(started?.stageOrigin).toBe("operator");
  await expect.poll(backlogTitles).not.toContain("Started task");
  await expect(board.getByLabel(`${lane}, Testing`).getByText("Started task", { exact: true })).toBeVisible();

  await hui.open(`/sessions/${started!.id}`);
  const transcript = screen.getByTestId("transcript");
  await expect(transcript).toContainText("# Started task");
  await expect(transcript).toContainText("## Problem");
  await expect(transcript).toContainText(problem);
  await expect(transcript).toContainText("## Proposed fix");
  await expect(transcript).toContainText(fix);
});
