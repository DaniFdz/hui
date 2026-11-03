/** Mirror browser state is off until the operator asks for it, and keeps the choice (SET-082). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("Mirror browser state is off by default and stays on", { tags: ["SET-082"], platforms: ["web"] }, async ({ screen, hui }) => {
  await hui.open("/settings/tools");
  const toggle = screen.getByRole("switch", { name: "Mirror browser state" });
  await expect(toggle).not.toBeChecked();
  await toggle.press("Space");
  await expect(toggle).toBeChecked();
  await expect.poll(async () => (await hui.api<Record<string, { mirrorState?: boolean }>>("GET", "/__hui/settings"))["browser"]?.mirrorState).toBe(true);
  await hui.reload();
  await expect(screen.getByRole("switch", { name: "Mirror browser state" })).toBeChecked();
});
