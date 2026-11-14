/** Closing a split pane takes only that pane, while its session keeps running and the other panes keep their draft (SESS-050). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("closing the pane of a streaming session leaves it running and the other at its draft, and the split shows it again", { tags: ["SESS-050"], platforms: ["web"] }, async ({ screen, hui }) => {
  const panes = screen.getByTestId("session-pane");
  await hui.wideScreen(2200);
  const staying = await hui.createSession({ title: "Kept pane" });
  await hui.createSession({ title: "Streaming pane" });

  await hui.open(`/sessions/${staying.id}`);
  await hui.sessionList();
  await (await hui.sessionMenu("Streaming pane")).getByText("Open in split pane", { visible: true }).tap();
  await expect(panes).toHaveCount(2);
  await expect(panes.nth(0).getByTestId("session-title")).toHaveText("Kept pane");
  await expect(panes.nth(1).getByTestId("session-title")).toHaveText("Streaming pane");

  await panes.nth(1).getByLabel("Message").fill("E2E_REPLAY");
  await panes.nth(1).getByRole("button", "Send message").tap();
  await hui.provider.held();
  await expect(panes.nth(1).getByLabel("Session status: Running", { visible: true })).toBeVisible();
  await panes.nth(0).getByLabel("Message").fill("Half-written note");

  await panes.nth(1).getByTestId("session-title").tap();
  await panes.nth(1).getByRole("button", "Close session pane").tap();
  await expect(panes).toHaveCount(1);
  await expect(panes.nth(0).getByTestId("session-title")).toHaveText("Kept pane");
  await expect(panes.nth(0).getByLabel("Message")).toHaveValue("Half-written note");

  // The running session is still in the registry, which is what lets the split show it again.
  await hui.sessionList();
  await expect(screen.getByLabel(/^Streaming pane, status running/u)).toBeVisible();

  await hui.sessionList();
  await (await hui.sessionMenu("Streaming pane")).getByText("Open in split pane", { visible: true }).tap();
  await expect(panes).toHaveCount(2);
  await expect(panes.nth(1).getByTestId("session-title")).toHaveText("Streaming pane");
  await expect(panes.nth(1).getByLabel("Session status: Running", { visible: true })).toBeVisible();
  await expect(panes.nth(1).getByText("Replay prefix —", { exact: false })).toBeVisible();

  await hui.provider.release();
  await expect(panes.nth(1).getByText("Replay prefix — replay suffix")).toBeVisible();
});
