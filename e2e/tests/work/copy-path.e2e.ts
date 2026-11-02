/** Copy full path copies the open file's absolute path and briefly reads Copied (WORK-055). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("Copy full path copies the open file's absolute path", { tags: ["WORK-055"], platforms: ["web"] }, async ({ screen, hui }) => {
  const session = await hui.createSession({ title: "Copy path" });
  await hui.clipboard();
  await hui.open(`/sessions/${session.id}`);
  await screen.getByRole("button", "Show Work pane").tap();
  await screen.getByRole("button", { name: /^Files/u }).tap();
  await screen.getByText("fixture.txt", { exact: true }).tap();

  const copy = screen.getByLabel("Copy full path");
  await expect(copy).toBeVisible();
  await copy.tap();
  await expect.poll(() => hui.copied()).toBe(`${hui.workspace}/fixture.txt`);
  await expect(copy).toHaveAttribute("data-hui-tooltip", "Copied");
});
