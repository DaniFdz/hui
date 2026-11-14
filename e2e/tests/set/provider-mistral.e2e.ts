/** The wizard offers Mistral's API-key sign-in, and cancelling it adds no card (SET-086). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("Mistral is offered with API-key sign-in and a cancelled sign-in adds no card", { tags: ["SET-086"], platforms: ["web"] }, async ({ screen, hui }) => {
  await hui.open("/settings/models");
  const add = screen.getByRole("button", "Connect a provider");
  await expect(add).toBeVisible();
  await add.tap();
  const close = screen.getByRole("button", "Close provider dialog");
  await expect(close).toBeVisible();
  await screen.getByRole("button", /^Mistral /u).tap();
  await screen.getByRole("button", /^API key /u).tap();
  await expect(screen.getByLabel("Enter Mistral API key", { exact: true })).toBeVisible();
  const cancel = screen.getByRole("button", "Cancel sign-in");
  // The picker stays busy until the host answers the start request.
  await expect(cancel).toBeEnabled();
  await cancel.tap();
  await expect(cancel).toBeHidden();
  await expect(close).toBeEnabled();
  await close.tap();
  await expect(screen.getByText("No model providers configured", { exact: true })).toBeVisible();
  await expect(screen.getByText("Sign in to a provider or add an API key, then continue.", { exact: true })).toBeVisible();
  await expect(close).toBeHidden();
});
