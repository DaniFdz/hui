/** Settings → Models connects a provider with an API key and keeps the model step when the save fails (SET-033), and
 * cancelling a pending sign-in adds no card (SET-035). */
import { expect } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";

type Provider = { id: string; configured: boolean; authenticated: boolean; accounts: { id: string; name: string }[]; selected: string[]; models: { id: string; name: string }[] };
type Snapshot = { providers: Provider[]; login?: { provider: string; phase: string } };

const snapshot = (hui: Hui) => hui.api<Snapshot>("GET", "/__hui/providers");
const configured = async (hui: Hui, id: string) => (await snapshot(hui)).providers.find((provider) => provider.id === id);
/** Leaves the run without the connection a failed test could not remove. */
const disconnect = (hui: Hui, id: string) => hui.api("DELETE", `/__hui/providers/${id}`);

test("Connect a provider offers each brand, asks OpenCode Go for an account name, adds a card from an API key whose models stay collapsed, and keeps the model step when the save fails", { tags: ["SET-033"], platforms: ["web"] }, async ({ screen, hui }) => {
  const page = screen.getByTestId("settings-page");
  const empty = page.getByText("No model providers configured", { exact: true });

  try {
    await hui.open("/settings/models");
    await expect(screen.getByText(/^Saved by HUI\./u)).toBeVisible({ timeout: 60_000 });
    await expect(empty).toBeVisible();

    await screen.getByRole("button", "Connect a provider").tap();
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
    await screen.getByRole("button", "Back", { exact: true }).tap();

    // Saving the model is a second write: a failure keeps the wizard on the model step with the error to retry.
    const save = await hui.intercept("PUT", /\/__hui\/providers\/openai$/u);
    await screen.getByRole("button", /^OpenAI /u).tap();
    await screen.getByRole("button", /^API key /u).tap();
    await screen.getByLabel("Enter OpenAI API key", { exact: true }).fill("sk-e2e-not-a-secret");
    await screen.getByRole("button", "Continue").tap();
    await expect(screen.getByText("Account connected. Choose a model when you want to test a reply.", { exact: true })).toBeVisible();
    await close.tap();
    await save.arrived();
    await save.reject(500, "The connection could not be saved.");
    await expect(screen.getByText("The connection could not be saved.", { exact: true })).toBeVisible();
    await expect(close).toBeVisible();

    // The retry is the same save: it succeeds against the gateway and closes with the connection.
    await close.tap();
    await expect(screen.getByText("OpenAI · all GPT models added. You can change its models any time.", { exact: true })).toBeVisible();
    await expect(close).toBeHidden();
    // A confirmed connection opens the provider configuration, whose card keeps its model list closed.
    await expect(screen.getByText("Provider configuration · 1 provider", { exact: true })).toBeVisible();
    await expect(screen.getByText("OpenAI · all GPT models", { exact: true })).toBeVisible();
    await expect(screen.getByText("Credentials available", { exact: true })).toBeVisible();
    await expect(screen.getByText("Models 1 selected", { exact: true })).toBeVisible();
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
  const browserStep = () => expect(screen.getByText("Complete sign-in in your browser, then return here.", { exact: true })).toBeVisible();
  const startClaude = async () => {
    await screen.getByRole("button", "Connect a provider").tap();
    await screen.getByRole("button", /^Claude /u).tap();
    await screen.getByRole("button", /^Claude Pro \/ Max/u).tap();
  };

  await hui.open("/settings/models");
  await expect(screen.getByText(/^Saved by HUI\./u)).toBeVisible({ timeout: 60_000 });
  await startClaude();
  // HUI picks the browser flow instead of asking, so the sign-in is pending while PI's callback server waits.
  const cancel = screen.getByRole("button", "Cancel sign-in");
  await browserStep();
  await expect(cancel).toBeEnabled();
  await cancel.tap();
  await expect(cancel).toBeHidden();
  expect((await snapshot(hui)).login?.phase).not.toBe("pending");
  // A cancelled sign-in stays in the wizard with its reason and both ways forward.
  await expect(screen.getByText("Sign-in cancelled", { exact: true })).toBeVisible();
  await expect(screen.getByRole("button", "Try again")).toBeVisible();

  // Closing the dialog while the sign-in is pending asks first, and cancelling there closes it.
  await screen.getByRole("button", "Choose another method").tap();
  await expect(screen.getByText("Choose how you want to sign in.", { exact: true })).toBeVisible();
  await screen.getByRole("button", /^Claude Pro \/ Max/u).tap();
  await browserStep();
  await screen.getByRole("button", "Close provider dialog").tap();
  await expect(screen.getByText("Sign-in is still waiting. Close and cancel it?", { exact: true })).toBeVisible();
  await screen.getByRole("button", "Cancel sign-in").tap();
  await expect(screen.getByRole("button", "Close provider dialog")).toBeHidden();

  // Nothing was added and the credentials the gateway already had are untouched.
  const after = await snapshot(hui);
  expect(after.login?.phase).not.toBe("pending");
  expect(after.providers.find((provider) => provider.id === "anthropic")?.accounts).toEqual([]);
  expect(after.providers.find((provider) => provider.id === "anthropic")?.configured).toBe(before.providers.find((provider) => provider.id === "anthropic")?.configured);
  expect((await hui.api<{ model: { authenticated: string[] } }>("GET", "/__hui/pi")).model.authenticated).toEqual(pi.model.authenticated);
  await expect(page.getByText("No model providers configured", { exact: true })).toBeVisible();
  await expect(screen.getByRole("button", "Connect a provider")).toBeVisible();
});
