/** Typing a project directory lists matching folders and choosing one fills the field and inspects its checkout (SESS-003). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("typing a project directory lists matching folders and choosing one inspects its checkout", { tags: ["SESS-003"], platforms: ["web"] }, async ({ screen, hui }) => {
  const repository = await hui.repository();
  const field = screen.getByPlaceholder("~/");
  const list = screen.getByRole("listbox", "Project directory");

  await hui.open("/");
  await field.fill(repository.path);
  await expect(list).toBeVisible();
  const option = list.getByRole("option").filter({ hasText: repository.path }).first();
  await expect(option).toBeVisible();
  await option.tap();
  await expect(field).toHaveValue(`${repository.path}/`);
  await expect(screen.getByLabel(/^Checkout: /u)).toBeVisible();
});
