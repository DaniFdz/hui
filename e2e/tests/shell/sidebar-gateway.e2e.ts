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
  await hui.sessionList();
  const trigger = screen.getByTestId("sidebar-gateway");
  await expect(trigger).toBeVisible();
  await expect(trigger).toContainText(name);
  await trigger.tap();

  // The current gateway is marked, and another one is named by what it answered.
  await expect(screen.getByText("Gateways", { exact: true })).toBeVisible();
  await expect(screen.getByText("Current", { exact: true })).toBeVisible();
  await expect(screen.getByText("Loft Studio", { exact: true })).toBeVisible();
  await expect(screen.getByText("Add a gateway…", { exact: true })).toBeVisible();

  // Add a gateway… leads to where addresses are managed. Escape is the web-only keyboard case SHELL-051.
  await screen.getByText("Add a gateway…", { exact: true }).tap();
  await expect(page.getByLabel("Gateway address")).toBeVisible();
  assert.match(await hui.url(), /\/settings\/connection$/u);
});

test("choosing another gateway in the footer opens its own page", { tags: ["SHELL-049"], platforms: ["web"] }, async ({ screen, hui }) => {
  const there = new URL(hui.gateway);
  there.hostname = "localhost";
  const name = (await hui.api<{ name: string }>("GET", "/__hui/health")).name;
  await hui.open("/settings/connection");
  const page = screen.getByTestId("settings-page");
  await page.getByLabel("Gateway address").fill(there.origin);
  await page.getByRole("button", "Add", { exact: true }).tap();
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
