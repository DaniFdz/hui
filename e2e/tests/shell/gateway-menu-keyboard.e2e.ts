/** Escape closes the gateway picker and returns focus to its trigger, a hardware-keyboard path (SHELL-051). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("Escape closes the gateway menu and returns focus to its button", { tags: ["SHELL-051"], platforms: ["web"] }, async ({ screen, hui }) => {
  await hui.wideScreen();
  await hui.open("/");
  const trigger = screen.getByTestId("sidebar-gateway");
  await expect(trigger).toBeVisible();
  await trigger.tap();
  const add = screen.getByText("Add a gateway…", { exact: true });
  await expect(add).toBeVisible();
  await add.press("Escape");
  await expect(add).toBeHidden();
  await expect(trigger).toBeFocused();
});
