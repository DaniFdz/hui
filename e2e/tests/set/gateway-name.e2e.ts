/** Settings → Gateway names the gateway: the empty field shows the hostname it reports instead, saving a name
 * keeps it across a reload and About lists it, and clearing it goes back to the hostname (SET-092). */
import { hostname } from "node:os";
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("naming the gateway in Settings reaches About and survives a reload", { tags: ["SET-092"], platforms: ["web"] }, async ({ screen, hui }) => {
  const page = screen.getByTestId("settings-page");
  const field = page.getByLabel("Gateway name");
  const machine = hostname();
  const reportedName = async () => (await hui.api<{ name: string }>("GET", "/__hui/health")).name;

  await hui.open("/settings/connection");
  await expect(field).toHaveValue("");
  await expect(field).toHaveAttribute("placeholder", machine);
  await expect(page.getByText(`Leave it empty to use this machine's hostname, ${machine}.`, { exact: true })).toBeVisible();
  expect(await reportedName()).toBe(machine);

  await field.fill("Studio Mac");
  await field.press("Enter");
  await expect(field).toHaveValue("Studio Mac");
  await expect(page.getByText("Shown to every client that connects, and on About.", { exact: true })).toBeVisible();
  await expect.poll(reportedName).toBe("Studio Mac");

  await hui.reload();
  await expect(field).toHaveValue("Studio Mac");
  await hui.open("/about");
  await expect(screen.getByTestId("page-title")).toHaveText("About");
  await expect(screen.getByText("Name", { exact: true, visible: true })).toBeVisible();
  await expect(screen.getByText("Studio Mac", { exact: true })).toBeVisible();

  await hui.open("/settings/connection");
  await field.fill("");
  await field.press("Enter");
  await expect(field).toHaveValue("");
  await expect(page.getByText(`Leave it empty to use this machine's hostname, ${machine}.`, { exact: true })).toBeVisible();
  await expect.poll(reportedName).toBe(machine);
  await hui.open("/about");
  await expect(screen.getByText(machine, { exact: true })).toBeVisible();
  await expect(screen.getByText("Studio Mac", { exact: true })).toBeHidden();
});
