/** Settings → Models chooses the primary, fallback and utility models, and the utility model names sessions and answers /btw (SET-045, SET-047). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("Primary, Fallback and Utility list the catalog and Use PI default, say when each runs and keep the choice after a reload", { tags: ["SET-045"] }, async ({ screen, hui }) => {
  await hui.open("/settings/models");
  await expect(screen.getByText("Saved by HUI and applied to new sessions.")).toBeVisible({ timeout: 60_000 });
  await expect(screen.getByText("The smartest model you have. Speed doesn't matter: it does the real work of new sessions and bots.")).toBeVisible();
  await expect(screen.getByText("Tried when the primary fails before producing useful output. Example: Anthropic Sonnet when OpenAI is unavailable.")).toBeVisible();
  await expect(screen.getByText(/^The fastest model you have, ideally a cheap one\. It names sessions and branches/u)).toBeVisible();

  for (const [route, model] of [["Primary model", "Opus fixture"], ["Fallback model", "HUI SDK Fixture"], ["Utility model", "Opus fixture"]] as const) {
    await screen.getByRole("button", `${route}: Use PI default`).tap();
    await expect.poll(() => hui.textOf(screen.getByLabel(route, { exact: true }))).toMatch(/^\s*Use PI default\s*HUI SDK Fixture\s*HUI Route Fixture\s*Opus fixture\s*$/u);
    await screen.getByLabel(route, { exact: true }).getByText(model, { exact: true }).tap();
    await expect(screen.getByRole("button", `${route}: ${model}`)).toBeVisible();
  }
  await expect.poll(async () => (await hui.api<{ models: Record<string, unknown> }>("GET", "/__hui/settings")).models)
    .toEqual({ primary: "hui-e2e/anthropic/claude-opus-5-5", fallback: "hui-e2e/fixture", utility: "hui-e2e/anthropic/claude-opus-5-5", routes: [] });

  await hui.reload();
  await expect(screen.getByRole("button", "Primary model: Opus fixture")).toBeVisible();
  await expect(screen.getByRole("button", "Fallback model: HUI SDK Fixture")).toBeVisible();
  await expect(screen.getByRole("button", "Utility model: Opus fixture")).toBeVisible();
});

test("the utility model names a new session from its first prompt and answers /btw in the side rail without touching the transcript", { tags: ["SET-047"], platforms: ["web"] }, async ({ screen, hui }) => {
  const transcript = screen.getByTestId("transcript");
  const rail = screen.getByLabel("Side chat");
  const settings = await hui.api<{ models: Record<string, string> }>("GET", "/__hui/settings");
  const start = async (utility: string, title: string) => {
    await hui.api("PUT", "/__hui/settings", { ...settings, models: { primary: "hui-e2e/fixture", fallback: "", utility } });
    await hui.open("/");
    await screen.getByPlaceholder("~/").fill(hui.workspace);
    await screen.getByPlaceholder("What should this session work on?").fill("Plan the release notes");
    await screen.getByRole("button", "Start session").tap();
    await expect(transcript.getByText("Fixture response.")).toBeVisible();
    await expect(screen.getByTestId("session-title", { visible: true })).toHaveText(title);
  };
  await start("", "Plan the release notes");
  await start("hui-e2e/anthropic/claude-opus-5-5", "Improve session naming");

  await screen.getByLabel("Message").fill("/btw which model answers this?");
  await screen.getByRole("button", "Send message").tap();
  await expect(rail.getByText("Ephemeral · hui-e2e/anthropic/claude-opus-5-5")).toBeVisible();
  await expect(rail.getByText("which model answers this?")).toBeVisible();
  await expect(rail.getByText("Fixture response.")).toBeVisible();
  await expect(transcript.getByText("Fixture response.")).toHaveCount(1);
  await expect(transcript.getByText("Plan the release notes")).toBeVisible();
  await expect(transcript.getByText("which model answers this?")).toBeHidden();
});
