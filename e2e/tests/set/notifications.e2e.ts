/** Settings → Notifications keeps which session events notify you across a reload (SET-076). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("Notifications keeps which session events notify you", { tags: ["SET-076"], platforms: ["web"] }, async ({ screen, hui }) => {
  await hui.open("/settings/notifications");
  const finished = screen.getByRole("switch", "Run finished");
  const failed = screen.getByRole("switch", "Run failed");
  const input = screen.getByRole("switch", "Needs your input");
  await expect(finished).toBeChecked({ checked: false });
  await expect(failed).toBeChecked();
  await expect(input).toBeChecked();

  await finished.tap({ position: { x: 8, y: 8 } });
  await failed.tap({ position: { x: 8, y: 8 } });
  await expect.poll(async () => (await hui.api<{ notifications: unknown }>("GET", "/__hui/settings")).notifications)
    .toEqual({ tool: false, runFinished: true, runFailed: false, needsInput: true });

  await hui.reload();
  await expect(finished).toBeChecked();
  await expect(failed).toBeChecked({ checked: false });
  await expect(input).toBeChecked();
});
