/** Escape closes the provider dialog, keeps Settings → Models open and returns focus to its trigger (SET-036). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";
import type { ProviderLogin, ProviderSnapshot } from "../../../src/api/schema/providers.ts";

test("Escape closes the provider dialog and returns focus to Settings → Models", { tags: ["SET-036"], platforms: ["web"] }, async ({ screen, hui }) => {
  const add = screen.getByRole("button", "Connect a provider");

  await hui.open("/settings/models");
  await expect(add).toBeVisible();
  await add.tap();
  const dialog = screen.getByRole("dialog", "Connect a provider");
  await expect(dialog).toBeVisible();

  await hui.keyboard.down("Escape");
  await hui.keyboard.up("Escape");
  await expect(dialog).toBeHidden();
  await expect(screen.getByTestId("settings-page-title")).toHaveText("Models");
  await expect(add).toBeFocused();

  // A sign-in that is still waiting asks first; Escape again keeps waiting.
  const real = await hui.api<ProviderSnapshot>("GET", "/__hui/providers");
  const login: ProviderLogin = {
    id: "hui-fixture-signin", provider: "openai-codex", phase: "pending", flow: "browser",
    url: "https://example.com/sign-in", message: "Waiting for the browser sign-in.",
  };
  await hui.answerAll("GET", /\/__hui\/providers$/u, JSON.stringify({ providers: real.providers, login }));
  const start = await hui.intercept("POST", /\/__hui\/providers\/openai-codex\/login$/);
  await add.tap();
  await screen.getByRole("button", /^OpenAI /u).tap();
  await screen.getByRole("button", /^ChatGPT account Codex/u).tap();
  await start.arrived();
  await start.answer(JSON.stringify(login));
  await expect(screen.getByText(/^Waiting for sign-in…/u)).toBeVisible();
  await hui.keyboard.down("Escape");
  await hui.keyboard.up("Escape");
  await expect(screen.getByText("Sign-in is still waiting. Close and cancel it?", { exact: true })).toBeVisible();
  await hui.keyboard.down("Escape");
  await hui.keyboard.up("Escape");
  await expect(screen.getByText("Sign-in is still waiting. Close and cancel it?", { exact: true })).toBeHidden();
  await expect(screen.getByText(/^Waiting for sign-in…/u)).toBeVisible();
});
