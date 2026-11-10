/** Two sessions at once in split panes: each pane keeps its own transcript, composer draft, queue and stream with its own
 * Stop, and a session with an unsent draft is marked on its row (SESS-049). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("two panes keep their own transcript, draft, queue and stream with their own Stop, and an unsent draft marks its session's row", { tags: ["SESS-049"], platforms: ["web"] }, async ({ screen, hui }) => {
  const panes = screen.getByTestId("session-pane");
  const alpha = await hui.createSession({ title: "Alpha pane" });
  await hui.createSession({ title: "Beta pane" });

  await hui.wideScreen(2200);
  await hui.open(`/sessions/${alpha.id}`);
  await hui.sessionList();
  await (await hui.sessionMenu("Beta pane")).getByText("Open in split pane", { visible: true }).tap();
  await expect(panes).toHaveCount(2);
  const first = panes.nth(0);
  const second = panes.nth(1);
  await expect(first.getByTestId("session-title")).toHaveText("Alpha pane");
  await expect(second.getByTestId("session-title")).toHaveText("Beta pane");

  // Both panes run at once, each with a Stop of its own.
  await first.getByLabel("Message").fill("E2E_REPLAY the alpha prompt");
  await first.getByRole("button", "Send message").tap();
  await hui.provider.held();
  await second.getByLabel("Message").fill("E2E_REPLAY the beta prompt");
  await second.getByRole("button", "Send message").tap();
  await expect(first.getByRole("button", "Stop")).toBeVisible();
  await expect(second.getByRole("button", "Stop")).toBeVisible();

  // Each composer holds a draft of its own while both run.
  await first.getByLabel("Message").fill("Alpha draft");
  await second.getByLabel("Message").fill("Beta draft");
  await expect(first.getByLabel("Message")).toHaveValue("Alpha draft");
  await expect(second.getByLabel("Message")).toHaveValue("Beta draft");
  await first.getByLabel("Message").fill("");
  await second.getByLabel("Message").fill("");

  // A follow-up queued in one pane waits in that pane's queue alone.
  await first.getByLabel("Message").fill("Alpha follow-up");
  await hui.hold(first.getByRole("button", "Steer message; touch and hold to enqueue"), first.getByText("Enqueue"));
  await first.getByText("Enqueue").tap();
  await expect(first.getByLabel("Queued messages").getByText("Alpha follow-up")).toBeVisible();
  await expect(second.getByLabel("Queued messages")).toBeHidden();

  // Stopping one pane's run leaves the other running.
  await second.getByRole("button", "Stop").tap();
  await expect(second.getByLabel("Session status: Idle")).toBeVisible();
  await expect(second.getByRole("button", "Stop")).toBeHidden();
  await expect(first.getByRole("button", "Stop")).toBeVisible();

  // Each pane draws its own transcript from its own stream.
  await hui.provider.release();
  await expect(first.getByTestId("transcript").getByText("Replay prefix — replay suffix")).toBeVisible();
  await expect(first.getByTestId("transcript").getByText("E2E_REPLAY the alpha prompt", { exact: true })).toBeVisible();
  await expect(first.getByTestId("transcript").getByText("E2E_REPLAY the beta prompt", { exact: true })).toBeHidden();
  await expect(second.getByTestId("transcript").getByText("E2E_REPLAY the beta prompt", { exact: true })).toBeVisible();
  await expect(second.getByTestId("transcript").getByText("Replay prefix —", { exact: false })).toBeVisible();
  await expect(second.getByTestId("transcript").getByText("E2E_REPLAY the alpha prompt", { exact: true })).toBeHidden();

  // An unsent draft marks its own session's row alone.
  await first.getByLabel("Message").fill("A draft kept in the pane");
  await hui.sessionList();
  await expect(screen.getByLabel(/^Alpha pane, status [a-z]+, tool durable, stage investigation, draft, open in split pane$/u)).toBeVisible();
  await expect(screen.getByLabel(/^Beta pane, status [a-z]+, tool durable, stage investigation, open in split pane$/u)).toBeVisible();
});
