/** Models keeps its catalog without PI's read-only sections and folds provider configuration (SET-050, SET-081). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";
import type { ProviderSnapshot } from "../../../src/api/schema/providers.ts";

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

test("Provider configuration folds without losing drafts and opens after setup", { tags: ["SET-081"], platforms: ["web"] }, async ({ screen, hui }) => {
  await hui.open("/settings/models");
  await expect(screen.getByText("No providers added yet. Add one to get started.", { exact: true })).toBeVisible();
  await expect(screen.getByText("Provider configuration · 0 providers", { exact: true })).toBeHidden();
  const configuration = screen.getByText("Provider configuration · 1 provider", { exact: true });
  const search = screen.getByLabel("Search Claude models", { exact: true });
  try {
    await screen.getByRole("button", "Add provider").tap();
    await screen.getByRole("button", /^Claude Claude account or API key\./u).tap();
    await screen.getByRole("button", /^API key /u).tap();
    await screen.getByLabel("Enter Anthropic API key", { exact: true }).fill("hui-fixture-not-a-real-key");
    await screen.getByRole("button", "Continue").tap();
    await expect(screen.getByText("Claude added. Choose the models you want to use.", { exact: true })).toBeVisible();
    await expect(configuration).toBeVisible();
    await expect(screen.getByText("Choose models", { exact: true })).toBeVisible();

    await hui.reload();
    await expect(configuration).toBeVisible();
    await expect(screen.getByText("HUI model routing", { exact: true })).toBeVisible();
    await expect(screen.getByRole("button", "Add account")).toBeHidden();
    await screen.getByRole("button", "Add provider").tap();
    await screen.getByRole("button", "Close provider dialog").tap();
    await expect(screen.getByRole("button", "Add account")).toBeHidden();
    await configuration.press("Enter");
    await screen.getByText("Choose models", { exact: true }).tap();
    await search.fill("sonnet");
    await screen.getByRole("button", "Select visible").tap();
    const selected = screen.getByText(/^[1-9]\d* selected$/u);
    await expect(selected).toBeVisible();
    const draft = await selected.allTextContents();
    await configuration.press("Enter");
    await expect(search).toBeHidden();
    await configuration.press("Space");
    await expect(search).toBeVisible();
    await expect(search).toHaveValue("sonnet");
    await expect.poll(() => selected.allTextContents()).toEqual(draft);
    await screen.getByRole("button", "Refresh limits").tap();
    await expect(screen.getByRole("button", "Refresh limits")).toBeVisible();
    await expect(search).toBeVisible();
    await expect(search).toHaveValue("sonnet");
    await expect.poll(() => selected.allTextContents()).toEqual(draft);
    const snapshot = await hui.api<ProviderSnapshot>("GET", "/__hui/providers");
    expect(snapshot.providers.find((provider) => provider.id === "anthropic")?.selected).toEqual([]);

    await hui.reload();
    await expect(configuration).toBeVisible();
    await expect(screen.getByText("HUI model routing", { exact: true })).toBeVisible();
    await expect(screen.getByRole("button", "Add account")).toBeHidden();
  } finally {
    await hui.api("DELETE", "/__hui/providers/anthropic");
  }
});
