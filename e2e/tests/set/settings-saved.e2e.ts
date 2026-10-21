/** Settings says whether a change was saved: a failed write turns the footer red and Appearance warns, the change applies now and is gone after a reload (SET-004). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("the footer and Appearance say a change was saved, and a failed write applies now but is forgotten after a reload", { tags: ["SET-004"], platforms: ["web"] }, async ({ screen, hui }) => {
  const sizes = screen.getByLabel("Text size");
  const chosen = (name: string) => sizes.getByRole("button", { name, pressed: true });
  const saved = screen.getByText("Settings saved locally");
  const notSaved = screen.getByText("Settings not saved");
  const probe = screen.getByText("Controls the maximum width of the conversation and composer.");

  await hui.open("/settings/appearance");
  await sizes.getByRole("button", "Large 110%").tap();
  await expect(chosen("Large 110%")).toBeVisible();
  await expect.poll(async () => (await hui.api<{ textScale: number }>("GET", "/__hui/settings")).textScale).toBe(110);
  await expect(saved).toBeVisible();
  await expect(screen.getByText("Saved to ~/.config/hui/settings.json")).toBeVisible();
  const ok = await hui.look(saved);
  const large = (await hui.look(probe)).size;

  const write = await hui.intercept("PUT", /\/__hui\/settings$/u);
  await sizes.getByRole("button", "XL 125%").tap();
  await write.reject(500, "disk full");
  await expect(notSaved).toBeVisible();
  await expect(saved).toBeHidden();
  await expect(screen.getByText("Could not write settings.json — changes apply now but will not be remembered.")).toBeVisible();
  const [r, g, b] = (await hui.look(notSaved)).color.match(/\d+/gu)!.map(Number) as [number, number, number];
  expect(r - Math.max(g, b)).toBeGreaterThan(80);
  expect((await hui.look(notSaved)).color).not.toBe(ok.color);
  await expect(chosen("XL 125%")).toBeVisible();
  expect((await hui.look(probe)).size).toBeCloseTo((large * 125) / 110, 0);

  await hui.reload();
  await expect(chosen("Large 110%")).toBeVisible();
  expect((await hui.look(probe)).size).toBeCloseTo(large, 1);
  await expect(saved).toBeVisible();

  await sizes.getByRole("button", "Default 100%").tap();
  await expect.poll(async () => (await hui.api<{ textScale: number }>("GET", "/__hui/settings")).textScale).toBe(100);
  await expect(saved).toBeVisible();
});
