/** Models says it is reading PI's configuration, names a failed read and recovers through Retry, then shows PI's configuration diagnostics and its settings path (SET-080). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

type Pi = { settings: { path: string }; diagnostics: string[] };

test("Models reports PI's configuration diagnostics and recovers after a failed load", { tags: ["SET-080"], platforms: ["web"] }, async ({ screen, hui }) => {
  const page = screen.getByTestId("settings-page");
  const pi = await hui.api<Pi>("GET", "/__hui/pi");

  const held = await hui.intercept("GET", /\/__hui\/pi$/u);
  await hui.open("/settings/models");
  await held.arrived();
  await expect(page.getByText("Reading pi configuration…", { exact: true })).toBeVisible();
  await held.reject(503, "PI settings are unreadable");
  await expect(page.getByText(/Could not read pi configuration:/u)).toBeVisible();
  await expect(page.getByText(/PI settings are unreadable/u)).toBeVisible();

  await page.getByRole("button", "Retry").click();
  await expect(page.getByText(pi.settings.path, { exact: true })).toBeVisible();

  // A held request answers PI's read with the crafted diagnostics: the phone target's WebView cannot take the engine's
  // answer-every-request stub, so the one read after the reload is held and answered.
  const crafted = await hui.intercept("GET", /\/__hui\/pi$/u);
  await hui.reload();
  await crafted.arrived();
  await crafted.answer(JSON.stringify({ ...pi, diagnostics: ["The OpenAI key expires tomorrow."] }));
  await expect(page.getByText("Configuration diagnostic", { exact: true })).toBeVisible();
  await expect(page.getByText("The OpenAI key expires tomorrow.", { exact: true })).toBeVisible();
});
