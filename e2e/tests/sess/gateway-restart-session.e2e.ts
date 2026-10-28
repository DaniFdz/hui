/** An open session shows Reconnecting while its gateway is away and returns to Idle once it is back at the same address, without a reload or a duplicate row (SESS-057). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("an open session waits through a gateway restart and is idle again without a reload or a duplicate sidebar row", { tags: ["SESS-057"], platforms: ["web"] }, async ({ screen, hui }) => {
  const session = await hui.createSession({ title: "Restart session" });
  const rows = screen.getByTestId("session-row").filter({ hasText: "Restart session" });
  await hui.open(`/sessions/${session.id}`);
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();
  await expect(rows).toHaveCount(1);

  const reconnect = await hui.intercept("POST", /\/__hui\/sessions\/[^/]+\/connect$/u);
  await hui.restartGateway();
  await reconnect.arrived();
  await expect(screen.getByText("Reconnecting — draft preserved.")).toBeVisible();
  await expect(rows).toHaveCount(1);

  await reconnect.deliver();
  await expect(screen.getByText("Reconnecting — draft preserved.")).toBeHidden();
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();
  await expect(rows).toHaveCount(1);
  await expect.poll(async () => new URL(await hui.url()).pathname).toBe(`/sessions/${session.id}`);
});