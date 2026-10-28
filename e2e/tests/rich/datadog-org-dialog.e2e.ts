/** The *Add org* dialog of Settings → Integrations → Datadog closes with Escape, keeps Settings open and puts focus
 * back on the button that opened it (RICH-043). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("Escape closes the Add Datadog org dialog, leaves Settings open and puts focus back on Add org", { tags: ["RICH-043"], platforms: ["web"] }, async ({ screen, hui }) => {
  const connection = await hui.intercept("GET", /\/__hui\/datadog$/u);
  const answering = connection.answer(JSON.stringify({ cli: { installed: true, version: "1.6.2" }, orgs: [], pupOrgs: [], login: { phase: "idle" } }));
  await hui.open("/settings/integrations");
  await answering;
  const add = screen.getByRole("button", "Add org").first();
  await add.tap();
  const title = screen.getByText("Add Datadog org", { exact: true });
  await expect(title).toBeVisible();
  const name = screen.getByRole("combobox", "Org name");
  await expect(name).toBeFocused();

  await name.press("Escape");
  await expect(title).toBeHidden();
  await expect(add).toBeVisible();
  await expect(add).toBeFocused();
  await expect(screen.getByText(/Share links preview without one\./u)).toBeVisible();
});
