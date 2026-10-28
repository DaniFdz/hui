/** Closing a split pane takes only that pane, while its session keeps running and the other panes keep their draft (SESS-050). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("closing the pane of a streaming session leaves it running and the other at its draft, and the split shows it again", { tags: ["SESS-050"], platforms: ["web"] }, async ({ screen, hui }) => {
  const panes = screen.getByTestId("session-pane");
  await hui.wideScreen(2200);
  const staying = await hui.createSession({ title: "Kept pane" });
  await hui.createSession({ title: "Streaming pane" });

  await hui.open(`/sessions/${staying.id}`);
  await screen.getByRole("button", "Open split view").tap();
  await expect(panes).toHaveCount(2);
  await (await hui.sessionMenu("Streaming pane")).getByText("Open in split pane", { visible: true }).tap();
  await expect(panes).toHaveCount(3);

  await panes.nth(2).getByLabel("Message").fill("E2E_REPLAY");
  await panes.nth(2).getByRole("button", "Send message").tap();
  await hui.provider.held();
  await expect(panes.nth(2).getByLabel("Session status: Running", { visible: true })).toBeVisible();
  await panes.nth(0).getByLabel("Message").fill("Half-written note");

  await panes.nth(2).getByTestId("session-title").tap();
  await panes.nth(2).getByRole("button", "Close session pane").tap();
  await expect(panes).toHaveCount(2);
  await expect(panes.nth(0).getByTestId("session-title")).toHaveText("Kept pane");
  await expect(panes.nth(1).getByTestId("session-title")).toHaveText("Kept pane");
  await expect(panes.nth(0).getByLabel("Message")).toHaveValue("Half-written note");

  await hui.sessionList();
  await expect(screen.getByLabel(/^Streaming pane, status running/u)).toBeVisible();
  await panes.nth(0).getByTestId("session-title").tap();
  await expect(panes.nth(0)).toHaveAttribute("aria-current", "true");

  await (await hui.sessionMenu("Streaming pane")).getByText("Open in split pane", { visible: true }).tap();
  await expect(panes).toHaveCount(3);
  await expect(panes.nth(2).getByTestId("session-title")).toHaveText("Streaming pane");
  await expect(panes.nth(2).getByLabel("Session status: Running", { visible: true })).toBeVisible();
  await expect(panes.nth(2).getByText("Replay prefix —", { exact: false })).toBeVisible();

  await hui.provider.release();
  await expect(panes.nth(2).getByText("Replay prefix — replay suffix")).toBeVisible();
});