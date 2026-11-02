/** A new session starts on the chosen primary model and its turns run there (SET-046). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

type Pi = { model: { catalog: { provider: string; id: string; name: string }[] } };

test("a new session starts on the chosen primary model and its turn answers", { tags: ["SET-046"], platforms: ["web"] }, async ({ screen, hui }) => {
  const pi = await hui.api<Pi>("GET", "/__hui/pi");
  const chosen = pi.model.catalog.find((model) => model.name !== "HUI SDK Fixture") ?? pi.model.catalog[0]!;
  const settings = await hui.api<{ models: Record<string, unknown> }>("GET", "/__hui/settings");
  await hui.api("PUT", "/__hui/settings", { ...settings, models: { ...settings.models, primary: `${chosen.provider}/${chosen.id}` } });

  const session = await hui.createSession({ title: "Primary model" });
  await hui.open(`/sessions/${session.id}`);
  await expect(screen.getByLabel(`Model: ${chosen.name}`)).toBeVisible();
  await screen.getByLabel("Message").fill("Run on the primary model");
  await screen.getByRole("button", "Send message").tap();
  await expect(screen.getByTestId("transcript").getByText("Fixture response.")).toBeVisible();
  await expect(screen.getByLabel(`Model: ${chosen.name}`)).toBeVisible();
});
