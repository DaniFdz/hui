/** The Work pane resize keys move the pane within its minimum and maximum (WORK-009). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("the Work pane resize keys move it within its bounds", { tags: ["WORK-009"], platforms: ["web"] }, async ({ screen, hui }) => {
  const session = await hui.createSession({ title: "Resize pane" });
  const resizer = screen.getByLabel("Resize Work pane");
  const width = async () => Number(await resizer.getAttribute("aria-valuenow"));

  await hui.wideScreen();
  await hui.open(`/sessions/${session.id}`);
  await screen.getByRole("button", "Show Work pane").tap();
  await screen.getByRole("button", { name: /^New terminal/u }).tap();

  const start = await width();
  await resizer.press("ArrowLeft");
  const wider = await width();
  expect(wider).toBeGreaterThan(start);
  await resizer.press("ArrowRight");
  expect(await width()).toBe(start);
  await resizer.press("Home");
  expect(await width()).toBe(320);
  await resizer.press("End");
  expect(await width()).toBeGreaterThan(wider);
});
