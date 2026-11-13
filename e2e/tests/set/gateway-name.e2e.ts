/** The current gateway's name is edited from its own Edit dialog: an empty name shows the hostname it reports,
 * saving a name keeps it across a reload and About lists it, and clearing it goes back to the hostname (SET-092). */
import { hostname } from "node:os";
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("naming the gateway from its Edit dialog reaches About and survives a reload", { tags: ["SET-092"], platforms: ["web"] }, async ({ screen, hui }) => {
  const page = screen.getByTestId("settings-page");
  const machine = hostname();
  const reportedName = async () => (await hui.api<{ name: string }>("GET", "/__hui/health")).name;
  const dialog = screen.getByLabel("Edit gateway", { exact: true });
  const name = dialog.getByLabel("Name", { exact: true });

  await hui.open("/settings/connection");
  // The standalone Gateway name section is gone: the current row's Edit is where the name lives.
  await expect(page.getByText("GATEWAY NAME", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Gateway name", { exact: true })).toHaveCount(0);
  expect(await reportedName()).toBe(machine);

  await page.getByRole("button", `Edit ${machine}`).tap();
  await expect(dialog).toBeVisible();
  await expect(name).toHaveValue("");
  await expect(name).toHaveAttribute("placeholder", "Uses this machine's hostname");
  await name.fill("Studio Mac");
  await name.press("Enter");
  await expect(dialog).toBeHidden();
  await expect.poll(reportedName).toBe("Studio Mac");
  await expect(page.getByRole("button", "Edit Studio Mac")).toBeVisible();

  await hui.reload();
  await page.getByRole("button", "Edit Studio Mac").tap();
  await expect(name).toHaveValue("Studio Mac");
  await expect(dialog.getByLabel("Address", { exact: true })).toBeDisabled();
  await dialog.getByRole("button", "Cancel").tap();
  await expect(dialog).toBeHidden();

  await hui.open("/about");
  await expect(screen.getByTestId("page-title")).toHaveText("About");
  // Scoped to About's Runtime rows: the sidebar footer names the gateway too.
  const runtime = screen.getByTestId("about-runtime");
  await expect(runtime.getByText("Name", { exact: true, visible: true })).toBeVisible();
  await expect(runtime.getByText("Studio Mac", { exact: true })).toBeVisible();

  await hui.open("/settings/connection");
  await page.getByRole("button", "Edit Studio Mac").tap();
  await name.fill("");
  await name.press("Enter");
  await expect(dialog).toBeHidden();
  await expect.poll(reportedName).toBe(machine);
  await expect(page.getByRole("button", `Edit ${machine}`)).toBeVisible();

  await hui.open("/about");
  await expect(runtime.getByText(machine, { exact: true })).toBeVisible();
  await expect(runtime.getByText("Studio Mac", { exact: true })).toBeHidden();
});
