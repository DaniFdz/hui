/** HUI's utility model writes each session's Task progress card, the Run status popover draws its plan (AGENT-053)
 * and the session row's hovercard reads the same stored card without opening the session (SESS-043). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";
import type { Settings } from "../../../src/api/schema/settings.ts";

test("Task progress follows the work in the Run status popover, folds, and survives a reload", { tags: ["AGENT-053"], platforms: ["web"] }, async ({ screen, hui }) => {
  const message = screen.getByLabel("Message");
  const send = screen.getByRole("button", "Send message");
  const trigger = screen.getByTestId("run-status-trigger");
  const plan = screen.getByTestId("task-progress");
  const steps = plan.getByLabel("Task progress steps");

  // HUI writes the card with the utility model; this instance points it at the fixture.
  const settings = await hui.api<Settings>("GET", "/__hui/settings");
  await hui.api("PUT", "/__hui/settings", { ...settings, models: { ...settings.models, utility: "hui-e2e/fixture" } });

  const session = await hui.createSession({ title: "Task progress" });
  await hui.open(`/sessions/${session.id}`);

  await message.fill("E2E_PROGRESS");
  await send.tap();

  // The plan lives in the popover and starts open on a wide window: the title, the count, the utility model's note and
  // each step's state.
  await expect(trigger).toHaveAccessibleName(/^Run status:/u);
  await trigger.tap();
  await expect(screen.getByLabel("Run status")).toBeVisible();
  await expect(steps).toBeVisible();
  await expect(plan.getByText("1 of 2")).toBeVisible();
  await expect(plan).toContainText("HUI's utility model writes this");
  await expect(plan.getByRole("listitem").filter({ hasText: "Read fixture" })).toHaveAttribute("data-status", "completed");
  await expect(plan.getByRole("listitem").filter({ hasText: "Verify presentation" })).toHaveAttribute("data-status", "in_progress");

  // The next turn rewrites it from the conversation: the plan moved on.
  await message.fill("E2E_PROGRESS_TWO");
  await send.tap();
  await trigger.tap();
  await expect(screen.getByLabel("Run status")).toBeVisible();
  await expect(plan.getByText("2 of 3")).toBeVisible();
  await expect(plan).toContainText("the plan moved on");

  // Folded: the current step and done/total stay on the section row.
  await plan.getByText("2 of 3").tap();
  await expect(steps).toBeHidden();
  await expect(screen.getByText("2 of 3", { visible: true })).toBeVisible();
  await expect(screen.getByText("Report the plan", { visible: true })).toBeVisible();
  await screen.getByText("2 of 3", { visible: true }).tap();
  await expect(steps).toBeVisible();

  // HUI stores the card with the session, so reopening the popover after a reload shows the same one.
  await hui.reload();
  await expect(screen.getByLabel("Run status")).toBeHidden();
  await trigger.tap();
  await expect(plan.getByText("2 of 3", { visible: true })).toBeVisible();
  await expect(plan).toContainText("the plan moved on");

  // Collapse task progress starts it folded even with work left.
  await hui.saveAppearance({ chat: { collapseTaskProgress: true } });
  await hui.reload();
  await trigger.tap();
  await expect(plan.getByText("2 of 3", { visible: true })).toBeVisible();
  await expect(steps).toBeHidden();
});

test("a session's stored card shows in its row hovercard without opening it", { tags: ["SESS-043"], platforms: ["web"] }, async ({ screen, hui }) => {
  const settings = await hui.api<Settings>("GET", "/__hui/settings");
  await hui.api("PUT", "/__hui/settings", { ...settings, models: { ...settings.models, utility: "hui-e2e/fixture" } });

  const session = await hui.createSession({ title: "Hovercard progress" });
  await hui.open(`/sessions/${session.id}`);
  await screen.getByLabel("Message").fill("E2E_PROGRESS");
  await screen.getByRole("button", "Send message").tap();
  await screen.getByTestId("run-status-trigger").tap();
  await expect(screen.getByText("1 of 2")).toBeVisible();

  // Home lists the session on its own: the stored card reaches the row's preview without opening anything.
  await hui.open("/");
  await screen.getByLabel(/, status idle, tool durable, stage investigation$/u).hover();
  await expect(screen.getByLabel("Agent Notepad")).toContainText("HUI's utility model writes this");
  await expect(screen.getByText("1/2")).toBeVisible();
  await expect(screen.getByText("Verify presentation")).toBeVisible();
});
