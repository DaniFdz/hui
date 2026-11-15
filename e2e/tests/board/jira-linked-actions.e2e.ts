/** A session that links a Jira work item no longer offers Create or Link, and both the sidebar menu and the Kanban card's Options open or copy that work item (BOARD-037). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("a linked session hides Create and Link Jira work item and gains Jira · <key> in the sidebar's Open in and Copy submenus and Open in Jira · <key> and Copy Jira link on its card, which copies the link", { tags: ["BOARD-037"], platforms: ["web"] }, async ({ screen, hui }) => {
  const world = await hui.world("jira");
  const session = (await world.api<{ groups: { sessions: { id: string; title: string }[] }[] }>("GET", "/__hui/sessions"))
    .groups.flatMap((group) => group.sessions).find(({ title }) => title === "Flaky CI retries");
  // The dialog's own call: link the work item, then read what the menus offer.
  await world.api("POST", `/__hui/sessions/${session!.id}/jira/link`, { key: "CI-1" });
  const issueUrl = `${world.jiraUrl}/browse/CI-1`;

  await hui.clipboard();
  await hui.open(`${world.url}/`);
  await hui.sessionList();
  const row = await hui.sessionMenu("Flaky CI retries");
  await expect(row.getByText("Create Jira work item…")).toBeHidden();
  await expect(row.getByText("Link Jira work item…")).toBeHidden();
  await row.getByText("Open in", { exact: true, visible: true }).tap();
  await expect(row.getByText("Jira · CI-1", { exact: true, visible: true })).toBeVisible();
  await row.getByText("Copy", { exact: true, visible: true }).tap();
  await row.getByText("Jira link · CI-1", { exact: true, visible: true }).tap();
  await expect(screen.getByText("Jira link copied.")).toBeVisible();
  await expect.poll(() => hui.copied()).toBe(issueUrl);

  await hui.open(`${world.url}/kanban`);
  const board = screen.getByLabel("Kanban board");
  await board.getByRole("button", { name: "Stage: Investigation. Options for Flaky CI retries" }).tap();
  const card = screen.getByLabel("Options for Flaky CI retries");
  await expect(card.getByText("Create Jira work item…")).toBeHidden();
  await expect(card.getByText("Link Jira work item…")).toBeHidden();
  await expect(card.getByText("Open in Jira · CI-1", { exact: true, visible: true })).toBeVisible();
  await card.getByText("Copy Jira link", { exact: true, visible: true }).tap();
  await expect.poll(() => hui.copied()).toBe(issueUrl);
  await expect(screen.getByText("Jira link copied.")).toBeVisible();
});
