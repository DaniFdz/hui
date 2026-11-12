/** The sidebar's footer lists this page's gateway and the others this device added, marked, switchable and reachable
 * from the menu (SHELL-049). */
import assert from "node:assert/strict";
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("the sidebar footer lists the gateways this device knows and marks the current one", { tags: ["SHELL-049"], platforms: ["web"] }, async ({ screen, hui }) => {
  const loft = await hui.gatewayStub("Loft Studio");
  const name = (await hui.api<{ name: string }>("GET", "/__hui/health")).name;

  // Another gateway is added first: the footer's list is about the ones that are not this page.
  await hui.open("/settings/connection");
  const page = screen.getByTestId("settings-page");
  await page.getByLabel("Gateway address").fill(loft.url);
  await page.getByRole("button", "Add", { exact: true }).tap();
  await expect(page.getByText("Loft Studio", { exact: true })).toBeVisible();

  await hui.open("/");
  const trigger = screen.getByTestId("sidebar-gateway");
  await expect(trigger).toBeVisible();
  await expect(trigger).toContainText(name);
  await trigger.tap();

  // The current gateway is marked, and another one is named by what it answered.
  await expect(screen.getByText("Gateways", { exact: true })).toBeVisible();
  await expect(screen.getByText("Current", { exact: true })).toBeVisible();
  await expect(screen.getByText("Loft Studio", { exact: true })).toBeVisible();
  await expect(screen.getByText("Add a gateway…", { exact: true })).toBeVisible();

  // Escape closes the list and returns focus to the button, as the session menus do.
  await screen.getByText("Add a gateway…", { exact: true }).press("Escape");
  await expect(screen.getByText("Add a gateway…", { exact: true })).toBeHidden();
  await expect(trigger).toBeFocused();

  // Add a gateway… leads to where addresses are managed.
  await trigger.tap();
  await screen.getByText("Add a gateway…", { exact: true }).tap();
  await expect(page.getByLabel("Gateway address")).toBeVisible();
  assert.match(await hui.url(), /\/settings\/connection$/u);
});
