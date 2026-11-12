/** Settings → Gateway manages this device's gateways: an address is added only when it answers the identity handshake,
 * an unreachable one is kept and reads Offline until Retry finds it, and Switch opens it (SET-093, SET-094). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("an address is added only when it answers as a gateway, and an unreachable one is kept as offline", { tags: ["SET-093"], platforms: ["web"] }, async ({ screen, hui }) => {
  const loft = await hui.gatewayStub("Loft Studio");
  const refused = await hui.gatewayStub("Nothing here");
  await refused.stop();

  await hui.open("/settings/connection");
  const page = screen.getByTestId("settings-page");
  const field = page.getByLabel("Gateway address");
  const add = page.getByRole("button", "Add", { exact: true });

  // An address that does not answer as HUI shows HUI's own wording, keeps the text to correct, and adds nothing.
  await field.fill(refused.url);
  await add.tap();
  await expect(page.getByText("This address doesn't answer as a HUI gateway.", { exact: true })).toBeVisible();
  await expect(field).toHaveValue(refused.url);
  await expect(page.getByText("Nothing here", { exact: true })).toHaveCount(0);

  // An address with no scheme is not one HUI can open at all.
  await field.fill("not an address");
  await add.tap();
  await expect(page.getByText("Enter an http:// or https:// address.", { exact: true })).toBeVisible();
  await expect(page.getByText("Nothing here", { exact: true })).toHaveCount(0);

  // A gateway that answers the handshake is stored under the name it gives there — the stub serves no health route.
  await field.fill(loft.url);
  await add.tap();
  await expect(page.getByText("Loft Studio", { exact: true })).toBeVisible();
  await expect(page.getByText("last seen just now", { exact: true })).toBeVisible();
  await expect(field).toHaveValue("");

  // Kept, and offline, once this page cannot reach it: Retry is offered, and nothing removes it by itself.
  await loft.stop();
  await hui.reload();
  await expect(page.getByText("Offline", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", "Retry Loft Studio")).toBeVisible();

  // Retry finds it again, and the row goes back to what it last saw.
  await loft.start();
  await page.getByRole("button", "Retry Loft Studio").tap();
  await expect(page.getByText("Offline", { exact: true })).toBeHidden();
  await expect(page.getByText("last seen just now", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", "Switch to Loft Studio")).toBeVisible();

  // Remove forgets it, and the current gateway is never offered one.
  await page.getByRole("button", "Remove Loft Studio").tap();
  await expect(page.getByText("Loft Studio", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", "Remove Loft Studio")).toHaveCount(0);
});

test("switching opens the chosen gateway in this page", { tags: ["SET-094"], platforms: ["web"] }, async ({ screen, hui }) => {
  // The same gateway at another origin: the switch must load a real HUI there, so this is a second origin, not a stub.
  const here = new URL(await hui.url());
  const there = `http://localhost:${here.port}`;
  const name = (await hui.api<{ name: string }>("GET", "/__hui/health")).name;

  await hui.open("/settings/connection");
  const page = screen.getByTestId("settings-page");
  await page.getByLabel("Gateway address").fill(there);
  await page.getByRole("button", "Add", { exact: true }).tap();
  await expect(page.getByText("Current", { exact: true })).toBeVisible();
  await page.getByRole("button", `Switch to ${name}`).tap();

  // The page is now that origin's app, and its footer names the gateway serving it.
  await expect.poll(() => hui.url()).toMatch(/^http:\/\/localhost:\d+\//u);
  await hui.sessionList();
  const trigger = screen.getByTestId("sidebar-gateway");
  await expect(trigger).toBeVisible();
  await expect(trigger).toContainText(name);

  // The list belongs to the address it was saved from: this origin starts its own.
  await trigger.tap();
  await expect(screen.getByText("Current", { exact: true })).toBeVisible();
  await expect(screen.getByText("127.0.0.1", { exact: true })).toHaveCount(0);
  await screen.getByText("Add a gateway…", { exact: true }).press("Escape");

  // Back to the checkout's own origin for the tests that follow.
  await hui.open("/");
});
