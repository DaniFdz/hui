/** A session row previews its session in a card: age, workspace, the unfinished plan step with its count while the run is paused, and the agent's notes; the row's menu dismisses it, focus opens it, and a touch tap opens the session instead (SESS-042). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

type Listed = { groups: { sessions: { id: string; progress?: { steps: unknown[] } }[] }[] };

test("hovering or focusing a row previews its age, workspace, paused plan step, count and notes, the row's menu dismisses that card, and a touch tap opens the session instead", { tags: ["SESS-042"], platforms: ["web"] }, async ({ screen, hui }) => {
  // The plan, and the notes the card shows, are the utility model's card, which no fixture configures by default.
  const settings = await hui.api<{ models: Record<string, string> }>("GET", "/__hui/settings");
  await hui.api("PUT", "/__hui/settings", { ...settings, models: { ...settings.models, utility: "hui-e2e/fixture" } });
  const workspace = hui.workspace.split("/").at(-1)!;
  const session = await hui.createSession({ title: "Preview from its row" });
  await hui.prompt(session, "Write the plan for this work");
  const card = screen.getByLabel("Session information");
  const row = screen.getByLabel(/^Preview from its row, status idle, tool durable, stage investigation/u);
  const touch = await hui.createSession({ title: "Touch opens the session" });
  await expect.poll(async () => (await hui.api<Listed>("GET", "/__hui/sessions")).groups
    .flatMap((group) => group.sessions).find(({ id }) => id === session.id)?.progress?.steps.length ?? 0).toBeGreaterThan(0);

  await hui.open("/");
  await hui.sessionList();
  await hui.peek(row);
  await expect(card).toBeVisible();
  await expect(card.getByText("Preview from its row", { exact: true })).toBeVisible();
  // Its age, as the short relative time the sidebar shows for a session created seconds ago.
  await expect(card.getByText(/^\d+[smhd]$/u)).toBeVisible();
  await expect(card.getByLabel(`Workspace: ${workspace}`)).toBeVisible();
  // Idle does not prove the plan finished, so its unfinished step stays and reports itself paused.
  await expect(card.getByLabel("Verify presentation, paused")).toBeVisible();
  await expect(card.getByText("1/2", { exact: true })).toBeVisible();
  await expect(card.getByLabel("Agent Notepad")).toContainText("Browser fixture, HUI's utility model writes this");

  await hui.sessionMenu("Preview from its row");
  await expect(card).toBeHidden();
  await screen.getByRole("button", "Actions for Preview from its row").press("Escape");
  await expect(screen.getByRole("menu")).toBeHidden();

  await row.focus();
  await expect(card).toBeVisible();
  await expect(card.getByLabel("Verify presentation, paused")).toBeVisible();
  await hui.keyboard.down("Escape");
  await hui.keyboard.up("Escape");
  await expect(card).toBeHidden();

  // On touch no card opens and the tap opens the session.
  await hui.sessionList();
  await hui.touchTap(screen.getByLabel(/^Touch opens the session, status idle, tool durable, stage investigation/u));
  await expect.poll(() => hui.url()).toMatch(new RegExp(`/sessions/${touch.id}$`, "u"));
  await expect(card).toBeHidden();
  await expect(screen.getByTestId("session-title", { visible: true })).toHaveText("Touch opens the session");
});
