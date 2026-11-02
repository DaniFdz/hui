/** The New Session model picker offers only the models the configured catalog reports (SET-048). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

type Pi = { model: { catalog: { provider: string; id: string; name: string }[] } };

test("the New Session model picker offers only the configured models", { tags: ["SET-048"], platforms: ["web"] }, async ({ screen, hui }) => {
  const pi = await hui.api<Pi>("GET", "/__hui/pi");

  await hui.open("/");
  await screen.getByLabel(/^Model: /u).first().tap();
  for (const model of pi.model.catalog) await expect(screen.getByText(model.name, { exact: true }).first()).toBeVisible();
  await expect(screen.getByText("Not a configured model", { exact: true })).toHaveCount(0);
});
