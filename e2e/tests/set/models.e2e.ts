/** Settings → Models routes new sessions, quick work and failed turns to the chosen models, offers only the configured ones and shows PI's own configuration while loading, failed and read (SET-045, SET-046, SET-047, SET-048, SET-050). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("Primary, Fallback and Utility list the catalog and Use PI default, say when each runs and keep the choice after a reload", { tags: ["SET-045"], platforms: ["web"] }, async ({ screen, hui }) => {
  await hui.open("/settings/models");
  await expect(screen.getByText("Saved by HUI and applied to new sessions.")).toBeVisible({ timeout: 60_000 });
  await expect(screen.getByText("The smartest model you have. Speed doesn't matter: it does the real work of new sessions and bots.")).toBeVisible();
  await expect(screen.getByText("Tried when the primary fails before producing useful output. Example: Anthropic Sonnet when OpenAI is unavailable.")).toBeVisible();
  await expect(screen.getByText(/^The fastest model you have, ideally a cheap one\. It names sessions and branches/u)).toBeVisible();

  for (const [route, model] of [["Primary model", "Opus fixture"], ["Fallback model", "HUI SDK Fixture"], ["Utility model", "Opus fixture"]] as const) {
    await screen.getByRole("button", `${route}: Use PI default`).tap();
    await expect(screen.getByLabel(route, { exact: true })).toHaveText("Use PI default HUI SDK Fixture Opus fixture");
    await screen.getByLabel(route, { exact: true }).getByText(model, { exact: true }).tap();
    await expect(screen.getByRole("button", `${route}: ${model}`)).toBeVisible();
  }
  await expect.poll(async () => (await hui.api<{ models: Record<string, string> }>("GET", "/__hui/settings")).models)
    .toEqual({ primary: "hui-e2e/anthropic/claude-opus-5-5", fallback: "hui-e2e/fixture", utility: "hui-e2e/anthropic/claude-opus-5-5" });

  await hui.reload();
  await expect(screen.getByRole("button", "Primary model: Opus fixture")).toBeVisible();
  await expect(screen.getByRole("button", "Fallback model: HUI SDK Fixture")).toBeVisible();
  await expect(screen.getByRole("button", "Utility model: Opus fixture")).toBeVisible();
});
