/** The managed browser starts and stops from Settings → Tools (SET-054). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("the managed browser starts and stops from Settings", { tags: ["SET-054"], platforms: ["web"] }, async ({ screen, hui }) => {
  await hui.open("/settings/tools");
  const start = screen.getByRole("button", "Start").first();
  await expect(start).toBeEnabled();
  await start.tap();
  const stop = screen.getByRole("button", "Stop").first();
  await expect(stop).toBeVisible({ timeout: 30_000 });
  await stop.tap();
  await expect(screen.getByRole("button", "Start").first()).toBeVisible({ timeout: 30_000 });
});
