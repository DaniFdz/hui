/** Settings → Models adds a provider with an API key and keeps the retry when the save fails (SET-033), and cancelling a pending sign-in adds no card (SET-035). */
import { expect } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";

type Provider = { id: string; configured: boolean; authenticated: boolean; accounts: { id: string; name: string }[]; selected: string[]; models: { id: string; name: string }[] };
type Snapshot = { providers: Provider[]; login?: { provider: string; phase: string } };

const snapshot = (hui: Hui) => hui.api<Snapshot>("GET", "/__hui/providers");
const configured = async (hui: Hui, id: string) => (await snapshot(hui)).providers.find((provider) => provider.id === id);
/** Leaves the run without the connection a failed test could not remove. */
const disconnect = (hui: Hui, id: string) => hui.api("DELETE", `/__hui/providers/${id}`);

test("Add provider offers each brand, asks OpenCode Go for an account name, adds a card from an API key whose models stay collapsed, and keeps Use this connection when the save fails", { tags: ["SET-033"], platforms: ["web"] }, async ({ screen, hui }) => {
  const page = screen.getByTestId("settings-page");
  const empty = page.getByText("No providers added yet. Add one to get started.", { exact: true });

  try {
    await hui.open("/settings/models");
    await expect(screen.getByText(/^Saved by HUI\./u)).toBeVisible({ timeout: 60_000 });
    await expect(empty).toBeVisible();

    await screen.getByRole("button", "Add provider").tap();
    const close = screen.getByRole("button", "Close provider dialog");
    await expect(close).toBeVisible();
    await expect(screen.getByRole("button", /^OpenCode Go /u)).toBeVisible();
    await expect(screen.getByRole("button", /^OpenAI /u)).toBeVisible();
    await expect(screen.getByRole("button", /^Claude /u)).toBeVisible();

    // OpenCode Go reports no name or email, so the account name comes before the sign-in method.
    await screen.getByRole("button", /^OpenCode Go /u).tap();
    await screen.getByRole("button", /^API key /u).tap();
    await expect(screen.getByText("Enter a name for this OpenCode account.", { exact: true })).toBeVisible();
    await expect(screen.getByLabel("Account name", { exact: true })).toBeVisible();
    await screen.getByRole("button", "Back to providers").tap();

    // Saving the connection is a second write: a failure keeps the modal with the connection to retry.
    const save = await hui.intercept("PUT", /\/__hui\/providers\/openai$/u);
    await screen.getByRole("button", /^OpenAI /u).tap();
    await screen.getByRole("button", /^API key /u).tap();
    await screen.getByLabel("Enter OpenAI API key", { exact: true }).fill("sk-e2e-not-a-secret");
    await screen.getByRole("button", "Continue").tap();
    await save.arrived();
    await save.reject(500, "The connection could not be saved.");
    await expect(screen.getByText("The connection could not be saved.", { exact: true })).toBeVisible();
    const retry = screen.getByRole("button", "Use this connection");
    await expect(retry).toBeVisible();

    await retry.tap();
    await expect(screen.getByText("OpenAI · API key added. Choose the models you want to use.", { exact: true })).toBeVisible();
    await expect(close).toBeHidden();
    // A confirmed connection opens the provider configuration, whose card keeps its model list closed.
    await expect(screen.getByText("Provider configuration · 1 provider", { exact: true })).toBeVisible();
    await expect(screen.getByText("OpenAI · API key", { exact: true })).toBeVisible();
    await expect(screen.getByText("Credentials available", { exact: true })).toBeVisible();
    await expect(screen.getByText("Models Choose models", { exact: true })).toBeVisible();
    expect((await configured(hui, "openai"))?.authenticated).toBe(true);
    await expect(empty).toBeHidden();
  } finally {
    await disconnect(hui, "openai").catch(() => undefined);
  }
});

test("Cancel sign-in, or the dialog's close button while it is pending, cancels the sign-in and adds no card", { tags: ["SET-035"], platforms: ["web"] }, async ({ screen, hui }) => {
  const page = screen.getByTestId("settings-page");
  const pi = await hui.api<{ model: { authenticated: string[] } }>("GET", "/__hui/pi");
  const before = await snapshot(hui);

  await hui.open("/settings/models");
  await expect(screen.getByText(/^Saved by HUI\./u)).toBeVisible({ timeout: 60_000 });
  await screen.getByRole("button", "Add provider").tap();
  await screen.getByRole("button", /^Claude /u).tap();
  await screen.getByRole("button", /^Claude Pro \/ Max/u).tap();
  // PI asks which Claude sign-in to run; the prompt makes the sign-in pending without reaching the network.
  const cancel = screen.getByRole("button", "Cancel sign-in");
  await expect(screen.getByLabel("Select Anthropic login method:", { exact: true })).toBeVisible();
  await expect(cancel).toBeEnabled();
  await cancel.tap();
  await expect(cancel).toBeHidden();
  expect((await snapshot(hui)).login?.phase).not.toBe("pending");

  // Closing the dialog while the sign-in is pending cancels it too.
  await screen.getByRole("button", /^Claude Pro \/ Max/u).tap();
  await expect(cancel).toBeEnabled();
  await screen.getByRole("button", "Close provider dialog").tap();
  await expect(screen.getByRole("button", "Close provider dialog")).toBeHidden();

  // Nothing was added and the credentials the gateway already had are untouched.
  const after = await snapshot(hui);
  expect(after.login?.phase).not.toBe("pending");
  expect(after.providers.find((provider) => provider.id === "anthropic")?.accounts).toEqual([]);
  expect(after.providers.find((provider) => provider.id === "anthropic")?.configured).toBe(before.providers.find((provider) => provider.id === "anthropic")?.configured);
  expect((await hui.api<{ model: { authenticated: string[] } }>("GET", "/__hui/pi")).model.authenticated).toEqual(pi.model.authenticated);
  await expect(page.getByText("No providers added yet. Add one to get started.", { exact: true })).toBeVisible();
  await expect(screen.getByRole("button", "Add provider")).toBeVisible();
});
