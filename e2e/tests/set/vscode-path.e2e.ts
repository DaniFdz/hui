/** A custom VS Code path that does not run is refused instead of being replaced (SET-057). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("a custom VS Code path that does not run is refused", { tags: ["SET-057"], platforms: ["web"] }, async ({ screen, hui }) => {
  const path = "/tmp/hui-no-vscode-here";

  await hui.open("/settings/tools");
  const input = screen.getByLabel("VS Code executable");
  await input.fill(path);
  await input.press("Enter");
  await expect(screen.getByText("Path does not run", { exact: true })).toBeVisible();
  await expect(screen.getByText(path, { exact: false }).first()).toBeVisible();

  await input.fill("");
  await input.press("Enter");
  await expect(screen.getByText("Path does not run", { exact: true })).toBeHidden();
});
