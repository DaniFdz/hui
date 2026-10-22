/** Settings → Models chooses the primary, fallback and utility models, the utility model names sessions and answers /btw, and Models shows PI's own configuration while loading, failed and read (SET-045, SET-047, SET-050). */
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

test("Models shows PI's defaults, cycling, credential sources and the collapsed catalog from PI's settings path, says while it reads and offers Retry when the read fails", { tags: ["SET-050"], platforms: ["web"] }, async ({ screen, hui }) => {
  const reading = screen.getByText("Reading pi configuration…");
  const catalog = screen.getByText("Available catalog · 2 models");
  const opusRow = screen.getByText("hui-e2e/anthropic/claude-opus-5-5", { exact: true });

  const loading = await hui.intercept("GET", /\/__hui\/pi$/u);
  await hui.open("/settings/models");
  await loading.arrived();
  await expect(reading).toBeVisible();
  await expect(catalog).toBeHidden();
  await loading.deliver();
  await expect(catalog).toBeVisible({ timeout: 60_000 });
  await expect(reading).toBeHidden();
  await expect(screen.getByText("Read-only fallbacks used when HUI has no primary route.")).toBeVisible();
  await expect(screen.getByText("pi's default provider.")).toBeVisible();
  await expect(screen.getByText("hui-e2e", { exact: true })).toBeVisible();
  await expect(screen.getByText("fixture", { exact: true })).toBeVisible();
  await expect(screen.getByText("high", { exact: true })).toBeVisible();
  await expect(screen.getByText("Not configured, so pi cycles through its own list.")).toBeVisible();
  await expect(screen.getByText("No provider credentials found.")).toBeVisible();
  await expect(screen.getByText(/HUI never writes here\./u)).toHaveText(/^Read from \/\S+\/agent\/settings\.json ?\. HUI never writes here\.$/u);
  await expect(screen.getByText("Problems reading pi's configuration.")).toBeHidden();
  await expect(opusRow).toBeHidden();
  await catalog.tap();
  await expect(screen.getByText("hui-e2e/fixture", { exact: true })).toBeVisible();
  await expect(opusRow).toBeVisible();

  const failing = await hui.intercept("GET", /\/__hui\/pi$/u);
  await hui.reload();
  await failing.reject(500, "pi is unreachable");
  await expect(screen.getByText("Could not read pi configuration: pi is unreachable")).toBeVisible();
  await expect(catalog).toBeHidden();
  await screen.getByRole("button", "Retry").tap();
  await expect(catalog).toBeVisible({ timeout: 60_000 });
  await expect(screen.getByText("Could not read pi configuration: pi is unreachable")).toBeHidden();
});

test("the utility model names a new session from its first prompt and answers /btw in the side rail without touching the transcript", { tags: ["SET-047"], platforms: ["web"] }, async ({ screen, hui }) => {
  const transcript = screen.getByTestId("transcript");
  const rail = screen.getByLabel("Side chat");
  const settings = await hui.api<{ models: Record<string, string> }>("GET", "/__hui/settings");
  await hui.api("PUT", "/__hui/settings", { ...settings, models: { ...settings.models, utility: "hui-e2e/anthropic/claude-opus-5-5" } });

  await hui.open("/");
  await screen.getByPlaceholder("~/").fill(hui.workspace);
  await screen.getByPlaceholder("What should this session work on?").fill("Plan the release notes");
  await screen.getByRole("button", "Start session").tap();
  await expect(transcript.getByText("Fixture response.")).toBeVisible();
  await expect(screen.getByTestId("session-title", { visible: true })).toHaveText("Improve session naming");

  await screen.getByLabel("Message").fill("/btw which model answers this?");
  await screen.getByRole("button", "Send message").tap();
  await expect(rail.getByText("Ephemeral · hui-e2e/anthropic/claude-opus-5-5")).toBeVisible();
  await expect(rail.getByText("which model answers this?")).toBeVisible();
  await expect(rail.getByText("Fixture response.")).toBeVisible();
  await expect(transcript.getByText("Fixture response.")).toHaveCount(1);
  await expect(transcript.getByText("Plan the release notes")).toBeVisible();
  await expect(transcript.getByText("which model answers this?")).toBeHidden();
});
