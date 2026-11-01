/** A backlog item moves to another custom group by dragging it inside Backlog or through Options → Move to group, and stays there after a reload (BOARD-020). */
import { expect } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";

const call = (name: string, input: unknown) => `E2E_CALL:${Buffer.from(JSON.stringify({ name, input })).toString("base64url")}`;
const sessionCount = async (hui: Hui) => (await hui.api<{ groups: { sessions: unknown[] }[] }>("GET", "/__hui/sessions")).groups.flatMap((group) => group.sessions).length;

test("dragging a backlog item into another custom lane or choosing Move to group changes only its group, and it stays there after a reload", { tags: ["BOARD-020"], platforms: ["web"] }, async ({ screen, hui }) => {
  await hui.createSession({ title: "Alpha anchor", group: "Alpha" });
  await hui.createSession({ title: "Beta anchor", group: "Beta" });
  const source = await hui.createSession({ title: "Backlog source" });
  await hui.prompt(source, call("suggest_task", { title: "Regroup me", problem: "Regroup me needs a look." }));
  await hui.open(`/sessions/${source.id}`);
  await screen.getByRole("button", "Add to backlog").tap();
  await expect(screen.getByText("Added “Regroup me” to the Kanban backlog.")).toBeVisible();

  await hui.open("/kanban");
  await screen.getByRole("button", "Board options").tap();
  await screen.getByText("Custom groups", { visible: true }).tap();
  const board = screen.getByLabel("Kanban board");
  const cell = (lane: string, stage = "Backlog") => board.getByLabel(`${lane}, ${stage}`);
  const item = board.getByRole("listitem").filter({ hasText: "Regroup me" });
  await expect(cell("OTHER").getByText("Regroup me")).toBeVisible();
  const sessions = await sessionCount(hui);

  await item.dragTo(cell("ALPHA"));
  await expect(screen.getByText("Moved Regroup me to ALPHA.")).toBeVisible();
  await expect(cell("ALPHA").getByText("Regroup me")).toBeVisible();

  await board.getByRole("button", "Options for Regroup me").tap();
  await item.getByText("BETA", { visible: true }).tap();
  await expect(screen.getByText("Moved Regroup me to BETA.")).toBeVisible();
  await expect(cell("BETA").getByText("Regroup me")).toBeVisible();
  expect(await sessionCount(hui)).toBe(sessions);

  await hui.reload();
  await expect(cell("BETA").getByText("Regroup me")).toBeVisible();
  expect(await sessionCount(hui)).toBe(sessions);
});
