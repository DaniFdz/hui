/** A progress_card call shows the plan, folds, refreshes, clears and returns after a reload (AGENT-053). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("Task progress shows the agent's plan, folds, refreshes, clears and returns after a reload", { tags: ["AGENT-053"], platforms: ["web"] }, async ({ screen, hui }) => {
  const message = screen.getByLabel("Message");
  const send = screen.getByRole("button", "Send message");
  const status = (value: string) => screen.getByLabel(`Session status: ${value}`);
  const transcript = screen.getByTestId("transcript");
  const card = screen.getByLabel("Task progress");
  const refresh = screen.getByRole("button", "Refresh task progress");

  const session = await hui.createSession({ title: "Task progress" });
  await hui.open(`/sessions/${session.id}`);
  await expect(status("Idle")).toBeVisible();

  await message.fill("E2E_PROGRESS");
  await send.tap();

  // It starts open: the title, the count, the agent's notes, and each step's state.
  await expect(screen.getByText("1 of 2")).toBeVisible();
  await expect(card).toContainText("Browser fixture");
  await expect(card).toContainText("real PI tool signal");
  await expect(card.getByRole("listitem").filter({ hasText: "Read fixture" })).toHaveAttribute("data-status", "completed");
  await expect(card.getByRole("listitem").filter({ hasText: "Verify presentation" })).toHaveAttribute("data-status", "in_progress");
  await expect(status("Idle")).toBeVisible();
  // The raw control call is never activity.
  await expect(transcript.getByText("progress_card")).toBeHidden();

  // Refreshing reads the session again and asks the agent for a card that matches the work now.
  await refresh.tap();
  await expect(screen.getByText("2 of 3")).toBeVisible();
  await expect(card).toContainText("refreshed after the click");
  await expect(card.getByRole("listitem").filter({ hasText: "Report the plan" })).toHaveAttribute("data-status", "in_progress");
  await expect(status("Idle")).toBeVisible();

  // Folded: the current step and done/total.
  await screen.getByText("2 of 3").tap();
  await expect(card).toBeHidden();
  await expect(screen.getByText("2/3")).toBeVisible();
  await expect(screen.getByText("Report the plan", { visible: true })).toBeVisible();

  // An empty call clears the card.
  await message.fill("E2E_CLEAR_PROGRESS");
  await send.tap();
  await expect(screen.getByText("2/3")).toBeHidden();

  // A later call brings it back, and it is still projected from PI's transcript after a reload.
  await message.fill("E2E_PROGRESS");
  await send.tap();
  await expect(screen.getByText("1 of 2")).toBeVisible();
  await hui.reload();
  await expect(screen.getByText("1 of 2")).toBeVisible();
  await expect(card).toContainText("real PI tool signal");

  // Collapse task progress starts it folded even with work left.
  const settings = await hui.api<{ chat: Record<string, unknown> }>("GET", "/__hui/settings");
  await hui.api("PUT", "/__hui/settings", { ...settings, chat: { ...settings.chat, collapseTaskProgress: true } });
  await hui.reload();
  await expect(screen.getByText("1/2")).toBeVisible();
  await expect(card).toBeHidden();
});
