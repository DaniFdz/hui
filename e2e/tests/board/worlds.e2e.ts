/**
 * The fixture worlds' capability checks: each world is another disposable gateway started by the checkout's own
 * visual-verification launcher with the flag that seeds it (`world.ts`), which is what the suite's single launcher
 * cannot be reconfigured into per test. Proven here, not in `e2e/tests/**`, because they check what the fixture can
 * drive: a Jira world makes a board card carry its work item's status and the Backlog list the items assigned to me
 * (BOARD-017 and the linked-item clauses of BOARD-002 to BOARD-037), a GitHub world makes the Contributions page read
 * the fake `gh` (BOARD-044 to BOARD-050), and an activity world seeds recorded work at chosen past times, a late-night
 * block included (BOARD-051 to BOARD-062).
 */
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("hui.world('jira') starts a gateway whose Jira is connected, so the Backlog lists the items assigned to me and a card carries its work item's status", { tags: ["BOARD-017"], platforms: ["web"] }, async ({ screen, hui }) => {
  const world = await hui.world("jira");
  const session = await world.createSession({ title: "Linked to CI-1" });
  // The dialog's own call: confirm the item is visible, then store the reference.
  await world.api("POST", `/__hui/sessions/${session.id}/jira/link`, { key: "CI-1" });

  await hui.open(`${world.url}/kanban`);
  const board = screen.getByLabel("Kanban board");
  // The Backlog half reads the fake Jira's assigned To Do items, not the note that says to connect one.
  await expect(board.getByRole("button", { name: "Developer tooling polish, Jira work item. Start a session" })).toBeVisible();
  await expect(board.getByRole("button", { name: "On-call hygiene, Jira work item. Start a session" })).toBeVisible();
  await expect(screen.getByText("Connect Jira in Settings → Integrations to list the work items assigned to you.")).toBeHidden();
  // The facts come from Jira too: a key with its status and summary, which is what a card without a connection cannot say.
  await expect(board.getByRole("link", { name: "Jira CI-1, in progress: Pipeline reliability" })).toBeVisible();
});

test("hui.world('github') starts a gateway whose gh is the fixture's, so Contributions reads its accounts and says when none is signed in", { tags: ["BOARD-044"], platforms: ["web"] }, async ({ screen, hui }) => {
  const world = await hui.world("github");
  await hui.open(`${world.url}/contributions`);
  const commits = screen.getByText(/^[\d,]+ commits in the last year$/u);
  await expect(commits).toBeVisible();
  // The fake gh serves two accounts; the picker narrows the report to one, so its own activity replaces the total.
  const both = await hui.textOf(commits);
  await screen.getByRole("button", { name: "Account: All accounts" }).tap();
  await screen.getByRole("option", { name: "hui-e2e-personal" }).tap();
  await expect(screen.getByRole("button", { name: "Account: hui-e2e-personal" })).toBeVisible();
  await expect.poll(() => hui.textOf(screen.getByText(/^[\d,]+ commits in the last year$/u))).not.toBe(both);
  // The other half of the page is the switch the use cases read.
  await screen.getByRole("button", "Pull requests").tap();
  await expect(screen.getByText(/^[\d,]+ pull requests in the last year$/u)).toBeVisible();
  // Signing `gh` out is the login state the page reports instead of an empty chart.
  await rm(join(world.runDir, "gh", "account"), { force: true });
  await rm(join(world.runDir, "gh", "accounts"), { force: true });
  await screen.getByRole("button", "Refresh").tap();
  await expect(screen.getByText(/^No GitHub account is signed in to/u)).toBeVisible();
  await expect(screen.getByRole("button", "Connect GitHub")).toBeVisible();
});

test("hui.world('activity') seeds recorded work at chosen past times, so a late-night block stays in the day it began", { tags: ["BOARD-062"], platforms: ["web"] }, async ({ screen, hui }) => {
  const world = await hui.world("activity");
  await hui.open(`${world.url}/contributions`);
  await screen.getByRole("button", "Calendar").tap();

  // The fixture seeds last week; this week holds only the last few hours.
  await screen.getByRole("button", "Previous week").tap();
  await screen.getByRole("button", "Session", { exact: true }).tap();
  await expect(screen.getByLabel("Time per session").getByText("Retry-safe checkout", { exact: true })).toBeVisible();

  // The activity day starts at 5 AM, so the block that runs from 10:40 PM to 1:55 AM belongs to the day it began: one
  // block of 3h 15m in that day's column, never two halves a day boundary apart.
  const day = new Date();
  day.setHours(5, 0, 0, 0);
  if (new Date() < day) day.setDate(day.getDate() - 1);
  day.setDate(day.getDate() - ((day.getDay() + 6) % 7) - 7 + 2);
  const heading = day.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  await screen.getByRole("button", { name: new RegExp(`^View ${heading.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}`, "u") }).tap();
  await expect(screen.getByRole("button", "Back to week")).toBeVisible();
  await expect(screen.getByRole("button", { name: /^Webhook double charge, .+, 3h 15m of activity$/u })).toBeVisible();
});
