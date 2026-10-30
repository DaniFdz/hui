/** HUI's utility model writes each session's Task progress card, and the composer draws it (AGENT-053). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";
import type { Settings } from "../../../src/api/schema/settings.ts";

test("Task progress follows the work, folds, and survives a reload", { tags: ["AGENT-053"], platforms: ["web"] }, async ({ screen, hui }) => {
  const message = screen.getByLabel("Message");
  const send = screen.getByRole("button", "Send message");
  const card = screen.getByLabel("Task progress");

  // HUI writes the card with the utility model; this instance points it at the fixture.
  const settings = await hui.api<Settings>("GET", "/__hui/settings");
  await hui.api("PUT", "/__hui/settings", { ...settings, models: { ...settings.models, utility: "hui-e2e/fixture" } });

  const session = await hui.createSession({ title: "Task progress" });
  await hui.open(`/sessions/${session.id}`);

  await message.fill("E2E_PROGRESS");
  await send.tap();

  // It starts open: the title, the count, the utility model's note and each step's state.
  await expect(screen.getByText("1 of 2")).toBeVisible();
  await expect(card).toContainText("HUI's utility model writes this");
  await expect(card.getByRole("listitem").filter({ hasText: "Read fixture" })).toHaveAttribute("data-status", "completed");
  await expect(card.getByRole("listitem").filter({ hasText: "Verify presentation" })).toHaveAttribute("data-status", "in_progress");

  // The next turn rewrites it from the conversation: the plan moved on.
  await message.fill("E2E_PROGRESS_TWO");
  await send.tap();
  await expect(screen.getByText("2 of 3")).toBeVisible();
  await expect(card).toContainText("the plan moved on");

  // Folded: the current step and done/total.
  await screen.getByText("2 of 3").tap();
  await expect(card).toBeHidden();
  await expect(screen.getByText("2/3")).toBeVisible();
  await expect(screen.getByText("Report the plan", { visible: true })).toBeVisible();

  // HUI stores the card with the session, so a reload shows the same one.
  await hui.reload();
  await expect(screen.getByText("2 of 3")).toBeVisible();
  await expect(card).toContainText("the plan moved on");

  // Collapse task progress starts it folded even with work left.
  const current = await hui.api<Settings>("GET", "/__hui/settings");
  await hui.api("PUT", "/__hui/settings", { ...current, chat: { ...current.chat, collapseTaskProgress: true } });
  await hui.reload();
  await expect(screen.getByText("2/3")).toBeVisible();
  await expect(card).toBeHidden();
});
