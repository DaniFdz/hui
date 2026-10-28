/** The Models page keeps its catalog and HUI controls without PI's read-only model sections (SET-050). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("Models keeps the catalog without PI defaults, cycling or credential sections", { tags: ["SET-050"], platforms: ["web"] }, async ({ screen, hui }) => {
  await hui.open("/settings/models");
  const catalog = screen.getByText("Available catalog · 2 models", { exact: true });
  await expect(catalog).toBeVisible();
  await expect(screen.getByText(/^(PI defaults|Cycling models|PI credential sources)$/u)).toHaveCount(0);
  await expect(screen.getByRole("button", "Add provider")).toBeVisible();
  await expect(screen.getByText("HUI model routing", { exact: true })).toBeVisible();
  await expect(screen.getByText("Subagent routes", { exact: true })).toBeVisible();
  await expect(screen.getByRole("button", "Default GPT-Live voice: Cove (GPT-Live's default)")).toBeVisible();
  await expect(screen.getByText("hui-e2e/fixture", { exact: true })).toBeHidden();
  await catalog.tap();
  for (const id of ["hui-e2e/fixture", "hui-e2e/fixture-deep"]) {
    await expect(screen.getByText(id, { exact: true })).toBeVisible();
  }
  await expect(screen.getByText("200,000 context · 4,096 max output", { exact: true })).toHaveCount(2);
  await expect(screen.getByText(/Read from .*settings\.json.*HUI never writes here\./su)).toBeVisible();
  await hui.reload();
  await expect(catalog).toBeVisible();
  await expect(screen.getByText("hui-e2e/fixture", { exact: true })).toBeHidden();
  await expect(screen.getByText(/^(PI defaults|Cycling models|PI credential sources)$/u)).toHaveCount(0);
});
