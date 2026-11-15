/** Settings → Models signs a second account in under a name of its own and lists the accounts in priority order, the
 * first ready one “Next to use” and the rest “Standby”; a cancelled sign-in adds no account (SET-040). */
import { expect, type Screen } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";

type Account = { id: string; name: string; authenticated: boolean };
type Provider = { id: string; configured: boolean; authenticated: boolean; accounts: Account[] };
type Snapshot = { providers: Provider[] };

const PROVIDER = "openai";
const CARD = "OpenAI · API key";
const KEY = "sk-e2e-not-a-secret";

const accounts = async (hui: Hui) => (await hui.api<Snapshot>("GET", "/__hui/providers")).providers.find((entry) => entry.id === PROVIDER)?.accounts ?? [];

/** Opens Settings → Models once its own settings have loaded, which its provider section waits for. */
const openModels = async (screen: Screen, hui: Hui) => {
  await hui.open("/settings/models");
  await expect(screen.getByText(/^Saved by HUI\./u)).toBeVisible({ timeout: 60_000 });
  await expect(screen.getByRole("button", "Add provider")).toBeVisible();
};

/** The page's provider card. Provider configuration starts folded on every visit and reload. */
const providerCard = async (screen: Screen) => {
  await screen.getByText("Provider configuration · 1 provider", { exact: true }).tap();
  const card = screen.getByRole("article", { name: CARD });
  await expect(card).toBeVisible();
  return card;
};

/** Completes the API-key sign-in the dialog has open. */
const signIn = async (screen: Screen, name?: string) => {
  if (name) await screen.getByLabel("Label when email is unavailable (optional)", { exact: true }).fill(name);
  await screen.getByRole("button", /^API key /u).tap();
  await screen.getByLabel("Enter OpenAI API key", { exact: true }).fill(KEY);
  await screen.getByRole("button", "Continue").tap();
  await expect(screen.getByRole("button", "Close provider dialog")).toBeHidden();
};

test("Add account signs a second account in under its own name, the card lists them in priority order with Next to use and Standby, and a cancelled sign-in adds none", { tags: ["SET-040"], platforms: ["web"] }, async ({ screen, hui }) => {
  try {
    await openModels(screen, hui);
    await screen.getByRole("button", "Add provider").tap();
    await screen.getByRole("button", /^OpenAI /u).tap();
    await signIn(screen, "Personal");
    await expect(screen.getByText("OpenAI · API key added. Choose the models you want to use.", { exact: true })).toBeVisible();

    // A second account signs in from the card, named by its own label.
    await screen.getByRole("button", "Add account").tap();
    await signIn(screen, "Work");
    await expect(screen.getByText("OpenAI · API key added. Choose the models you want to use.", { exact: true })).toBeVisible();
    expect((await accounts(hui)).map(({ name, authenticated }) => ({ name, authenticated }))).toEqual([
      { name: "Personal", authenticated: true },
      { name: "Work", authenticated: true },
    ]);

    // The first account typed is the first row and the one to use; the newer one stands by.
    const card = screen.getByRole("article", { name: CARD });
    const rows = card.getByRole("article");
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toHaveAccessibleName("Personal");
    await expect(rows.nth(1)).toHaveAccessibleName("Work");
    await expect(rows.nth(0).getByText("1.", { exact: true })).toBeVisible();
    await expect(rows.nth(0).getByText("Next to use", { exact: true })).toBeVisible();
    await expect(rows.nth(1).getByText("2.", { exact: true })).toBeVisible();
    await expect(rows.nth(1).getByText("Standby", { exact: true })).toBeVisible();

    // A cancelled sign-in adds no account and leaves the two in place.
    await screen.getByRole("button", "Add account").tap();
    await screen.getByRole("button", /^API key /u).tap();
    const cancel = screen.getByRole("button", "Cancel sign-in");
    await expect(cancel).toBeEnabled();
    await cancel.tap();
    await expect(cancel).toBeHidden();
    await screen.getByRole("button", "Close provider dialog").tap();
    await expect(rows).toHaveCount(2);
    expect((await accounts(hui)).map(({ name }) => name)).toEqual(["Personal", "Work"]);

    // A reload keeps the accounts, their order and which one is next.
    await hui.reload();
    const reopened = await providerCard(screen);
    await expect(reopened.getByRole("article")).toHaveCount(2);
    await expect(reopened.getByRole("article").nth(0)).toHaveAccessibleName("Personal");
    await expect(reopened.getByRole("article").nth(1)).toHaveAccessibleName("Work");
    await expect(reopened.getByRole("article").nth(0).getByText("Next to use", { exact: true })).toBeVisible();
    await expect(reopened.getByRole("article").nth(1).getByText("Standby", { exact: true })).toBeVisible();
  } finally {
    await hui.api("DELETE", `/__hui/providers/${PROVIDER}`).catch(() => undefined);
  }
});
