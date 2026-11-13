/** Settings → Gateway manages this device's gateways: a gateway is added from a dialog with its own name and address,
 * an address that does not answer the handshake is refused in the dialog, an unreachable one is kept and reads Offline
 * until Retry finds it, Edit changes a saved connection or the current gateway's own name, and Switch opens one
 * (SET-093, SET-094, SET-097). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("a gateway is added from a dialog with a name and an address, and an unreachable one is kept as offline", { tags: ["SET-093"], platforms: ["web"] }, async ({ screen, hui }) => {
  const loft = await hui.gatewayStub("Loft Studio");
  const refused = await hui.gatewayStub("Nothing here");
  await refused.stop();

  await hui.open("/settings/connection");
  const page = screen.getByTestId("settings-page");
  const add = page.getByRole("button", "Add gateway");
  const dialog = screen.getByLabel("Add gateway", { exact: true });
  const name = dialog.getByLabel("Name", { exact: true });
  const address = dialog.getByLabel("Address", { exact: true });

  // Add opens a dialog with both fields, focused on the name.
  await add.tap();
  await expect(dialog).toBeVisible();
  await expect(name).toBeFocused();
  await expect(address).toHaveValue("");

  // An address that does not answer as HUI shows HUI's own wording in the dialog, keeps both values, and adds nothing.
  await name.fill("Nothing here");
  await address.fill(refused.url);
  await dialog.getByRole("button", "Add gateway").tap();
  await expect(dialog.getByText("This address doesn't answer as a HUI gateway.", { exact: true })).toBeVisible();
  await expect(dialog).toBeVisible();
  await expect(name).toHaveValue("Nothing here");
  await expect(address).toHaveValue(refused.url);
  await dialog.getByRole("button", "Cancel").tap();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("Nothing here", { exact: true })).toHaveCount(0);

  // An address with no scheme is not one HUI can open at all.
  await add.tap();
  await name.fill("Nothing here");
  await address.fill("not an address");
  await dialog.getByRole("button", "Add gateway").tap();
  await expect(dialog.getByText("Enter an http:// or https:// address.", { exact: true })).toBeVisible();
  await expect(dialog).toBeVisible();

  // A gateway that answers the handshake is stored under the name it gives when no name is typed — the stub serves no
  // health route — and a scheme-less address is read as http.
  await name.fill("");
  await address.fill(loft.url.replace(/^http:\/\//u, ""));
  await dialog.getByRole("button", "Add gateway").tap();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("Loft Studio", { exact: true })).toBeVisible();
  await expect(page.getByText(loft.url, { exact: true })).toBeVisible();
  await expect(page.getByText("last seen just now", { exact: true })).toBeVisible();

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

test("Edit changes a saved gateway's name and address, and only the current gateway's name", { tags: ["SET-097"], platforms: ["web"] }, async ({ screen, hui }) => {
  const loft = await hui.gatewayStub("Loft Studio");
  const attic = await hui.gatewayStub("Attic");
  const den = await hui.gatewayStub("Den");
  const current = (await hui.api<{ name: string }>("GET", "/__hui/health")).name;
  const here = new URL(await hui.url());

  await hui.open("/settings/connection");
  const page = screen.getByTestId("settings-page");
  const addDialog = screen.getByLabel("Add gateway", { exact: true });
  await page.getByRole("button", "Add gateway").tap();
  await addDialog.getByLabel("Name", { exact: true }).fill("Loft");
  await addDialog.getByLabel("Address", { exact: true }).fill(loft.url);
  await addDialog.getByRole("button", "Add gateway").tap();
  await expect(addDialog).toBeHidden();
  await page.getByRole("button", "Add gateway").tap();
  await addDialog.getByLabel("Name", { exact: true }).fill("Den");
  await addDialog.getByLabel("Address", { exact: true }).fill(den.url);
  await addDialog.getByRole("button", "Add gateway").tap();
  await expect(addDialog).toBeHidden();

  // A rename that does not move the address saves in place, and the row keeps its sighting.
  await page.getByRole("button", "Edit Loft").tap();
  const edit = screen.getByLabel("Edit gateway", { exact: true });
  await expect(edit).toBeVisible();
  await expect(edit.getByLabel("Name", { exact: true })).toHaveValue("Loft");
  await expect(edit.getByLabel("Address", { exact: true })).toHaveValue(loft.url);
  await edit.getByLabel("Name", { exact: true }).fill("Loft studio");
  await edit.getByRole("button", "Save changes").tap();
  await expect(edit).toBeHidden();
  await expect(page.getByText("Loft studio", { exact: true })).toBeVisible();
  await expect(page.getByText(loft.url, { exact: true })).toBeVisible();

  // The chosen name is this device's own: reaching the gateway again refreshes its sighting, not its label.
  await hui.reload();
  const loftRow = page.getByRole("listitem").filter({ hasText: "Loft studio" });
  await expect(loftRow.getByText("Loft studio", { exact: true })).toBeVisible();
  await expect(loftRow.getByText("last seen just now", { exact: true })).toBeVisible();

  // Moving to another address probes it first and moves the one row there.
  await page.getByRole("button", "Edit Loft studio").tap();
  await expect(edit).toBeVisible();
  await edit.getByLabel("Name", { exact: true }).fill("Attic");
  await edit.getByLabel("Address", { exact: true }).fill(attic.url);
  await edit.getByRole("button", "Save changes").tap();
  await expect(edit).toBeHidden();
  await expect(page.getByText("Attic", { exact: true })).toBeVisible();
  await expect(page.getByText(attic.url, { exact: true })).toBeVisible();
  await expect(page.getByText(loft.url, { exact: true })).toHaveCount(0);

  // An address that is already this page's gateway, or another saved row, is refused without moving anything.
  await page.getByRole("button", "Edit Attic").tap();
  await edit.getByLabel("Address", { exact: true }).fill(here.origin);
  await edit.getByRole("button", "Save changes").tap();
  await expect(edit.getByText("This is the gateway serving this page.", { exact: true })).toBeVisible();
  await edit.getByLabel("Address", { exact: true }).fill(den.url);
  await edit.getByRole("button", "Save changes").tap();
  await expect(edit.getByText("That gateway is already in your list.", { exact: true })).toBeVisible();
  await edit.getByRole("button", "Cancel").tap();
  await expect(edit).toBeHidden();

  // The gateway serving this page keeps its address; Edit saves the name every client sees.
  await page.getByRole("button", `Edit ${current}`).tap();
  const currentDialog = screen.getByLabel("Edit gateway", { exact: true });
  await expect(currentDialog.getByLabel("Address", { exact: true })).toHaveValue(here.origin);
  await expect(currentDialog.getByLabel("Address", { exact: true })).toBeDisabled();
  await currentDialog.getByLabel("Name", { exact: true }).fill("Studio Mac");
  await currentDialog.getByRole("button", "Save changes").tap();
  await expect(currentDialog).toBeHidden();
  await expect(page.getByText("Studio Mac", { exact: true })).toBeVisible();
  await expect(page.getByText(here.origin, { exact: true })).toBeVisible();

  // Every surface that names this gateway shows the saved name, including the sidebar footer.
  await hui.settingsPages();
  await screen.getByRole("button", "Exit Settings").tap();
  await hui.sessionList();
  await expect(screen.getByTestId("sidebar-gateway")).toContainText("Studio Mac");
});

test("switching opens the chosen gateway in this page", { tags: ["SET-094"], platforms: ["web"] }, async ({ screen, hui }) => {
  // The same gateway at another origin: the switch must load a real HUI there, so this is a second origin, not a stub.
  const here = new URL(await hui.url());
  const there = `http://localhost:${here.port}`;
  const name = (await hui.api<{ name: string }>("GET", "/__hui/health")).name;

  await hui.open("/settings/connection");
  const page = screen.getByTestId("settings-page");
  const dialog = screen.getByLabel("Add gateway", { exact: true });
  await page.getByRole("button", "Add gateway").tap();
  await dialog.getByLabel("Address", { exact: true }).fill(there);
  await dialog.getByRole("button", "Add gateway").tap();
  await expect(dialog).toBeHidden();
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
  await trigger.tap();
  await expect(screen.getByText("Add a gateway…", { exact: true })).toBeHidden();

  // Back to the checkout's own origin for the tests that follow.
  await hui.open("/");
});
