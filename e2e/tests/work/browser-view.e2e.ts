/** The conversation's one Browser view: Browser in the + menu opens it before the agent has browsed, it says so and
 * that it is view only, and once the agent browses the chat's own preview card shows that same tab, live and headless,
 * with its address and the last thing the agent did (WORK-039). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";
import { backToChat, hideWork, openWork, reopenWork } from "./work-views.ts";

test("the browser view says no page is open before the agent browses, then shows the agent's headless tab from its preview card", { tags: ["WORK-039"], platforms: ["web"] }, async ({ screen, hui }) => {
  const repository = await hui.repository();
  const session = await hui.createSession({ title: "Watch the browser", cwd: repository.path });
  const pane = screen.getByLabel("Work pane");
  const transcript = screen.getByTestId("transcript");
  const preview = transcript.getByRole("button", "Open browser view");

  await hui.open(`/sessions/${session.id}`);
  await openWork(screen, "Browser");

  // Nothing has been browsed yet: the view holds nothing, names no address, and says it is the agent's to drive.
  await expect(pane.getByRole("tab", "Browser")).toHaveAttribute("aria-selected", "true");
  await expect(pane.getByText(/^No page is open in this conversation yet\./u)).toBeVisible();
  await expect(pane.getByText("View only · the agent controls this browser")).toBeVisible();
  await expect(pane.getByText("No page", { exact: true })).toBeVisible();

  // The agent browses in its own headless browser, and the view shows that tab, its address and what it did last.
  await hui.prompt(session, "E2E_BROWSER");
  // A phone shows the Work destination instead of the chat, so the settled turn is read from the chat and the view is
  // then shown again from the chooser.
  await backToChat(screen);
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible({ timeout: 120_000 });
  await reopenWork(screen, "Browser");
  await expect(pane.getByText(/^(Live|Idle) · headless$/u)).toBeVisible();
  await expect(pane.getByText(/^http:\/\/127\.0\.0\.1:\d+\/browser-fixture$/u)).toBeVisible();
  await expect(pane.getByText("Took a screenshot")).toBeVisible();
  await expect(pane.getByText("View only · the agent controls this browser")).toHaveCount(0);

  // The chat's preview card opens that same view, expanding the pane it is hidden in without adding a second one.
  await hideWork(screen);
  await preview.tap();
  await expect(pane.getByRole("tab", "Browser")).toHaveAttribute("aria-selected", "true");
  await expect(pane.getByRole("tab")).toHaveCount(1);
});
