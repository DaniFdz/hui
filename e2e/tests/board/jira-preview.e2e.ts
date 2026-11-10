/** A Kanban card shows the Jira work item it is linked to by key and status, and hovering its mark previews the work item with its type, status, summary and description (BOARD-034). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("a card's linked Jira mark shows its key and status, and hovering it previews the work item's type, status, summary and description", { tags: ["BOARD-034"], platforms: ["web"] }, async ({ screen, hui }) => {
  // A live Jira (e2e/fixtures/jira-fixture.mjs): without one the mark can only say "Status unavailable".
  const jira = await hui.jira();
  const session = await hui.createSession({ title: "Jira preview card" });
  const linked = await hui.api<{ issue: { key: string; url: string } }>("POST", `/__hui/sessions/${session.id}/jira/link`, { key: "CI-1" });
  expect(linked.issue.url).toBe(`${jira.origin}/browse/CI-1`);

  await hui.open("/kanban");
  const board = screen.getByLabel("Kanban board");
  const card = board.getByRole("listitem").filter({ hasText: "Jira preview card" });
  // The card names Jira's own facts, not just the key the transcript happened to mention.
  const mark = card.getByRole("link", "Jira CI-1, in progress: Pipeline reliability");
  await expect(mark).toHaveAttribute("href", `${jira.origin}/browse/CI-1`);
  await expect(mark).toHaveAttribute("target", "_blank");
  await expect(card.getByText("CI-1", { exact: true })).toBeVisible();
  await expect(card.getByText("In Progress", { exact: true })).toBeVisible();

  // The mark is the chip's leading icon, so the pointer goes to its left, not to the key beside it.
  await hui.peek(mark, { x: 8 });
  const preview = screen.getByRole("tooltip");
  await expect(preview.getByText("CI-1 · Epic", { exact: true })).toBeVisible();
  await expect(preview.getByText("In Progress", { exact: true })).toBeVisible();
  await expect(preview.getByText("Pipeline reliability", { exact: true })).toBeVisible();
  // The description arrives as Jira's document converted to Markdown: a heading, prose with code, and a list.
  await expect(preview.getByRole("heading", "Goal")).toBeVisible();
  await expect(preview.getByText("Cut flaky pipeline failures in half this quarter. Track every retry wrapper in", { exact: false })).toBeVisible();
  await expect(preview.getByRole("listitem").filter({ hasText: "Retry wrappers surface the first failure" })).toBeVisible();
});
