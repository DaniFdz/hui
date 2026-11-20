/** A gateway that cannot be reached is never a page that loads forever: the boot screen's recovery card names the address
 * this page came from, offers Retry, every other gateway this device saved and Add a gateway (whose probe refuses what
 * the Add dialog refuses, and opens a gateway that answers in this page), and never moves the page except when a person
 * switches (SHELL-057). The sidebar's Offline state after the app has painted is proved by the component and controller
 * tests of the same change, not here. */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("a gateway that cannot be reached offers the other gateways and opens the one chosen", { tags: ["SHELL-057"], platforms: ["web"] }, async ({ screen, hui }) => {
  // 1. This page's gateway, painted: `here` is the origin it serves this page from, and `there` is the same gateway at
  //    another origin, so the switch at the end loads a real HUI rather than a stub.
  await hui.open("/");
  await hui.sessionList();
  const here = new URL(await hui.url());
  const there = `http://localhost:${here.port}`;
  const name = (await hui.api<{ name: string }>("GET", "/__hui/health")).name;

  // 2. A second gateway this device knows, added through Settings (SET-094).
  await hui.open("/settings/connection");
  const page = screen.getByTestId("settings-page");
  const dialog = screen.getByLabel("Add gateway", { exact: true });
  await page.getByRole("button", "Add gateway").tap();
  await dialog.getByLabel("Address", { exact: true }).fill(there);
  await dialog.getByRole("button", "Add gateway").tap();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", `Switch to ${name}`)).toBeVisible();

  // 3. The boot screen's own way out, for a gateway that accepts the page and never answers its health route. The
  //    cached shell would boot on its own, so the app's own chunk is held exactly as SHELL-020 and SHELL-022 hold it:
  //    the boot screen is what a person sees, and the health probe is refused under it.
  await hui.clearOffline();
  const code = await hui.holdAppChunks();
  const health = await hui.intercept("GET", /\/__hui\/health$/u);
  await hui.reload();
  await code.arrived();
  await health.arrived();
  await health.reject(503, "the gateway is not answering its health route");

  const heading = screen.getByRole("heading", { name: "Can't reach this gateway." });
  await expect(heading).toBeVisible();
  await expect(heading).toBeFocused();
  await expect(screen.getByText(here.origin, { exact: true })).toBeVisible();
  await expect(screen.getByRole("button", "Retry")).toBeVisible();
  await expect(screen.getByRole("button", `Switch to ${name}`)).toBeVisible();
  await expect(screen.getByText(new URL(there).host, { exact: true })).toBeVisible();

  // 4. Add refuses what the Add dialog refuses, in its own words, and never moves the page.
  const bootUrl = await hui.url();
  const add = screen.getByText("Add a gateway", { exact: true });
  await add.tap();
  const nameField = screen.getByLabel("Name", { exact: true });
  const addressField = screen.getByLabel("Address", { exact: true });
  await nameField.fill("Studio");
  await addressField.fill("not an address");
  await screen.getByRole("button", "Add and switch").tap();
  await expect(screen.getByText("Enter an http:// or https:// address.", { exact: true })).toBeVisible();

  await addressField.fill(here.origin);
  await screen.getByRole("button", "Add and switch").tap();
  await expect(screen.getByText("This is the gateway serving this page.", { exact: true })).toBeVisible();

  await addressField.fill(there);
  await screen.getByRole("button", "Add and switch").tap();
  await expect(screen.getByText("That gateway is already in your list.", { exact: true })).toBeVisible();
  expect(await hui.url()).toBe(bootUrl);
  await add.tap();
  await expect(addressField).toBeHidden();

  // 5. Switch opens that gateway in this page: a real HUI of its own, naming the gateway that serves it. Its app chunk
  //    is the same address on another origin, so the held route delivers it too.
  await screen.getByRole("button", `Switch to ${name}`).tap();
  await code.deliver();
  await expect.poll(() => hui.url()).toMatch(/^http:\/\/localhost:\d+\//u);
  await hui.sessionList();
  const arrived = screen.getByTestId("sidebar-gateway");
  await expect(arrived).toContainText(name);
  await expect(arrived).toHaveAttribute("aria-label", `Gateway: ${name}`);

  // Back to the checkout's own origin for the tests that follow.
  await hui.open("/");
});
