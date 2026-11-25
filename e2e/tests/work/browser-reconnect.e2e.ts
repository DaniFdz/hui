/** A live view that loses its connection: it says Disconnected with the reason, keeps the last frame it painted, and
 * Reconnect streams the tab it was watching again (WORK-041). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";
import { openWork } from "./work-views.ts";

test("the live view says Disconnected and why when it loses its connection, and Reconnect streams the watched tab again", { tags: ["WORK-041"], platforms: ["web"] }, async ({ screen, hui }) => {
  const session = await hui.createSession({ title: "Browser reconnect" });
  const pane = screen.getByLabel("Work pane");
  const picker = pane.getByRole("button", /^Browser tab: /u);
  const reconnect = pane.getByRole("button", "Reconnect");

  await hui.wideScreen();
  await hui.open(`/sessions/${session.id}`);
  await openWork(screen, "Browser");
  await hui.prompt(session, "E2E_BROWSER");
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible({ timeout: 120_000 });
  const tab = (await picker.getAttribute("aria-label")) ?? "";
  const title = tab.split(" · ")[1] ?? "";
  const frame = pane.getByRole("img", { name: `Live view of ${title}` });
  await expect(frame).toBeVisible();
  await expect(pane.getByText("Disconnected", { exact: true })).toHaveCount(0);

  // The connection drops while the gateway refuses the view's next socket. Each refused attempt waits out its own
  // backoff, so the controlled clock carries the view through every retry instead of the test waiting for them.
  await hui.controllableClock();
  const refused = await hui.answerAll("POST", /\/__hui\/sessions\/[^/]+\/browser\/connect$/u, JSON.stringify({ error: "The live view is unavailable." }), 503);
  await hui.dropStreams();
  const saysDisconnected = async () => {
    await hui.advanceClock(10_000);
    return pane.getByText("Disconnected", { exact: true }).isVisible();
  };
  await expect.poll(saysDisconnected, { timeout: 30_000 }).toBe(true);
  // It gave up on the live connection and offers to take it back, with the last frame it painted still on screen.
  await expect(reconnect).toBeVisible();
  await expect(frame).toBeVisible();

  // A page that loads while the connection is refused has no frame to keep, so it says both that it is disconnected
  // and why, with nothing left to draw.
  await hui.reload();
  await openWork(screen, "Browser");
  await expect.poll(saysDisconnected, { timeout: 30_000 }).toBe(true);
  await expect(pane.getByText("The live view is disconnected.", { exact: true })).toBeVisible();
  await expect(reconnect).toBeVisible();

  // Reconnect resumes streaming the tab the view was watching.
  await refused.stop();
  await reconnect.tap();
  await expect(pane.getByText(/^Live · headless$/u)).toBeVisible();
  await expect(picker).toHaveAttribute("aria-label", new RegExp(`^Browser tab: t\\d+ · ${title}$`, "u"));
  await expect(frame).toBeVisible();
  await expect(pane.getByText("Disconnected", { exact: true })).toHaveCount(0);
});
