/** A row's preview card: hovering it with a fine pointer or focusing it shows the session's age, workspace, unfinished
 * plan step and count with its paused clock and its Markdown notes; opening the row's menu dismisses it; on touch no card
 * opens and a tap opens the session (SESS-042). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("a row's card opens on hover or focus with the age, workspace, paused plan step and notes, its menu dismisses it, and a touch opens the session instead", { tags: ["SESS-042"], platforms: ["web"] }, async ({ screen, hui }) => {
  // The card's plan and notes are the ones HUI's utility model writes; this instance points it at the fixture.
  const settings = await hui.api<{ models: Record<string, string> }>("GET", "/__hui/settings");
  await hui.api("PUT", "/__hui/settings", { ...settings, models: { ...settings.models, utility: "hui-e2e/fixture" } });
  const session = await hui.createSession({ title: "Preview me" });
  await hui.open(`/sessions/${session.id}`);
  await screen.getByLabel("Message").fill("E2E_PROGRESS");
  await screen.getByRole("button", "Send message").tap();
  await expect(screen.getByTestId("run-status-trigger")).toHaveAccessibleName(/1 of 2 steps done/u);

  await hui.open("/");
  const row = screen.getByLabel(/^Preview me, status idle, tool durable, stage investigation$/u);
  const plan = screen.getByLabel("Verify presentation, paused");
  const notes = screen.getByLabel("Agent Notepad");

  // The pointer resting on the row opens the card beside it.
  await hui.peek(row);
  await expect(plan).toBeVisible();
  expect((await plan.boundingBox())!.x).toBeGreaterThanOrEqual((await row.boundingBox())!.x + (await row.boundingBox())!.width - 24);
  // The age the card draws, next to the created time it keeps in its tooltip.
  await expect(screen.getByText(/^\d+(?: \d+[ms]|[smh])$/u)).toBeVisible();
  await expect(screen.getByLabel("Workspace: workspace")).toBeVisible();
  await expect(notes).toContainText("HUI's utility model writes this");
  await expect(screen.getByText("1/2", { exact: true })).toBeVisible();

  // Opening the row's menu dismisses it.
  await hui.sessionMenu("Preview me");
  await expect(screen.getByText("Archive session", { visible: true })).toBeVisible();
  await expect(plan).toBeHidden();
  await expect(notes).toBeHidden();
  await screen.getByRole("button", "Actions for Preview me").press("Escape");
  await expect(screen.getByText("Archive session", { visible: true })).toBeHidden();

  // Keyboard focus on the row opens it too.
  await row.focus();
  await expect(row).toBeFocused();
  await expect(plan).toBeVisible();

  // A touch opens the session and no card.
  await hui.touchTap(row);
  await expect.poll(async () => new URL(await hui.url()).pathname).toBe(`/sessions/${session.id}`);
  await expect(screen.getByTestId("session-title", { visible: true })).toHaveText("Preview me");
  await expect(plan).toBeHidden();
  await expect(notes).toBeHidden();
});
