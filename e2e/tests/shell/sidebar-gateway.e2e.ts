/** The sidebar's footer lists this page's gateway and the others this device added, marked, switchable and added in
 * place from the menu (SHELL-049). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("the sidebar footer lists the gateways this device knows, marks the current one and adds another", { tags: ["SHELL-049"], platforms: ["web"] }, async ({ screen, hui }) => {
  const loft = await hui.gatewayStub("Loft Studio");
  const name = (await hui.api<{ name: string }>("GET", "/__hui/health")).name;

  await hui.open("/");
  await hui.sessionList();
  const trigger = screen.getByTestId("sidebar-gateway");
  await expect(trigger).toBeVisible();
  await expect(trigger).toContainText(name);
  await trigger.tap();

  // The current gateway is marked, and Add a gateway… is the last item.
  await expect(screen.getByText("Gateways", { exact: true })).toBeVisible();
  await expect(screen.getByText("Current", { exact: true })).toBeVisible();
  await expect(screen.getByText("Add a gateway…", { exact: true })).toBeVisible();

  // Add a gateway… opens the dialog in place. Escape/focus restoration is the web-only case SHELL-051.
  const before = await hui.url();
  await screen.getByText("Add a gateway…", { exact: true }).tap();
  const dialog = screen.getByLabel("Add gateway", { exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Name", { exact: true })).toBeFocused();
  await dialog.getByLabel("Name", { exact: true }).fill("Loft");
  await dialog.getByLabel("Address", { exact: true }).fill(loft.url);
  await dialog.getByRole("button", "Add gateway").tap();
  await expect(dialog).toBeHidden();
  expect(await hui.url()).toBe(before);

  // The new gateway joins the list under the name chosen in the dialog, back in the phone's drawer too.
  await hui.sessionList();
  await trigger.tap();
  await expect(screen.getByText("Loft", { exact: true })).toBeVisible();
  await expect(screen.getByText("Current", { exact: true })).toBeVisible();
  await trigger.tap();
  await expect(screen.getByText("Add a gateway…", { exact: true })).toBeHidden();
});

test("choosing another gateway in the footer opens its own page", { tags: ["SHELL-049"], platforms: ["web"] }, async ({ screen, hui }) => {
  const there = new URL(hui.gateway);
  there.hostname = "localhost";
  const name = (await hui.api<{ name: string }>("GET", "/__hui/health")).name;
  await hui.open("/settings/connection");
  const page = screen.getByTestId("settings-page");
  await page.getByRole("button", "Add gateway").tap();
  const dialog = screen.getByLabel("Add gateway", { exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Address", { exact: true }).fill(there.origin);
  await dialog.getByRole("button", "Add gateway").tap();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", `Switch to ${name}`)).toBeVisible();
  await hui.open("/");
  await hui.sessionList();
  await screen.getByTestId("sidebar-gateway").tap();
  // The disabled current item also has Current in its accessible name; this is the other gateway's item.
  await screen.getByRole("menuitem", { name, exact: true }).tap();
  await expect.poll(() => hui.url()).toMatch(/^http:\/\/localhost:\d+\//u);
  await hui.sessionList();
  await expect(screen.getByTestId("sidebar-gateway")).toContainText(name);
  await hui.open("/");
});
