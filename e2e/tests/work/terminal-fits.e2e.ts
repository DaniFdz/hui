/** The shared terminal fits the Work pane and follows its resize (WORK-037). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("the shared terminal fits the Work pane and follows its resize", { tags: ["WORK-037"], platforms: ["web"] }, async ({ screen, hui }) => {
  const session = await hui.createSession({ title: "Fit the terminal" });
  const pane = screen.getByLabel("Work pane");
  const resizer = screen.getByLabel("Resize Work pane");

  await hui.wideScreen();
  await hui.open(`/sessions/${session.id}`);
  await screen.getByRole("button", "Show Work pane").tap();
  await screen.getByRole("button", { name: /^New terminal/u }).tap();
  const input = screen.getByLabel("Shared terminal input");
  await expect(input).toBeVisible();

  const paneBox = (await pane.boundingBox())!;
  const before = (await input.boundingBox())!.width;
  expect(before).toBeLessThanOrEqual(paneBox.width);
  await resizer.press("ArrowLeft");
  await expect.poll(async () => (await input.boundingBox())!.width).toBeGreaterThan(before);
});
