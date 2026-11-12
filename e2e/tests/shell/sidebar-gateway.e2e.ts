/** The sidebar's footer lists this page's gateway and the others this device added, marked, switchable and added in
 * place from the menu (SHELL-049). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("the sidebar footer lists the gateways this device knows, marks the current one and adds another", { tags: ["SHELL-049"], platforms: ["web"] }, async ({ screen, hui }) => {
  const loft = await hui.gatewayStub("Loft Studio");
  const name = (await hui.api<{ name: string }>("GET", "/__hui/health")).name;

  await hui.open("/");
  const trigger = screen.getByTestId("sidebar-gateway");
  await expect(trigger).toBeVisible();
  await expect(trigger).toContainText(name);
  await trigger.tap();

  // The current gateway is marked, and Add a gateway… is the last item.
  await expect(screen.getByText("Gateways", { exact: true })).toBeVisible();
  await expect(screen.getByText("Current", { exact: true })).toBeVisible();
  await expect(screen.getByText("Add a gateway…", { exact: true })).toBeVisible();

  // Escape closes the list and returns focus to the button, as the session menus do.
  await screen.getByText("Add a gateway…", { exact: true }).press("Escape");
  await expect(screen.getByText("Add a gateway…", { exact: true })).toBeHidden();
  await expect(trigger).toBeFocused();

  // Add a gateway… opens the dialog in place, without leaving the page for Settings.
  const before = await hui.url();
  await trigger.tap();
  await screen.getByText("Add a gateway…", { exact: true }).tap();
  const dialog = screen.getByLabel("Add gateway", { exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Name", { exact: true })).toBeFocused();
  await dialog.getByLabel("Name", { exact: true }).fill("Loft");
  await dialog.getByLabel("Address", { exact: true }).fill(loft.url);
  await dialog.getByRole("button", "Add gateway").tap();
  await expect(dialog).toBeHidden();
  expect(await hui.url()).toBe(before);

  // The new gateway joins the list under the name chosen in the dialog.
  await trigger.tap();
  await expect(screen.getByText("Loft", { exact: true })).toBeVisible();
  await expect(screen.getByText("Current", { exact: true })).toBeVisible();
  await screen.getByText("Add a gateway…", { exact: true }).press("Escape");
});
