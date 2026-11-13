/** Options → Copy copies a backlog item as Markdown and says so (BOARD-021). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

const call = (name: string, input: unknown) => `E2E_CALL:${Buffer.from(JSON.stringify({ name, input })).toString("base64url")}`;

test("Options → Copy copies the backlog item as Markdown and shows Copied “<title>”", { tags: ["BOARD-021"], platforms: ["web"] }, async ({ screen, hui }) => {
  const problem = "The copy action has nothing to prove.";
  const fix = "Record the Markdown the card copies.";
  const source = await hui.createSession({ title: "Copy task source" });
  await hui.prompt(source, call("suggest_task", { title: "Copyable task", problem, fix }));
  await hui.open(`/sessions/${source.id}`);
  await screen.getByRole("button", "Add to backlog").tap();
  await expect(screen.getByText("Added “Copyable task” to the Kanban backlog.")).toBeVisible();

  await hui.clipboard();
  await hui.open("/kanban");
  const board = screen.getByLabel("Kanban board");
  await expect(board.getByText("Copyable task")).toBeVisible();
  await board.getByRole("button", "Options for Copyable task").tap();
  await screen.getByLabel("Options for Copyable task").getByText("Copy", { visible: true }).tap();
  await expect(screen.getByText("Copied “Copyable task”.")).toBeVisible();
  await expect.poll(() => hui.copied()).toBe([
    "# Copyable task",
    "## Problem",
    problem,
    "## Proposed fix",
    fix,
  ].join("\n\n"));
  await expect(board.getByText("Copyable task")).toBeVisible();
});
