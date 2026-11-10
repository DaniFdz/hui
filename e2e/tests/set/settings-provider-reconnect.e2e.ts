/**
 * Settings → Models reads a provider, or one of its accounts, whose saved credential is gone as “Sign in to reconnect”
 * with only “Sign in”, no limits and no model list, and signing in again reuses the saved account and its name (SET-039).
 */
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { expect, type Screen } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";

type Account = { id: string; name: string; authenticated: boolean };
type Provider = { id: string; configured: boolean; authenticated: boolean; accounts: Account[]; selected: string[]; models: { id: string; name: string }[] };
type Snapshot = { providers: Provider[] };

/** OpenAI's API-key sign-in asks PI for the key and saves it locally, so a card can be signed in without a live provider. */
const PROVIDER = "openai";
const CARD = "OpenAI · API key";
const KEY = "sk-e2e-not-a-secret";
const ADDED = "OpenAI · API key added. Choose the models you want to use.";

const snapshot = (hui: Hui) => hui.api<Snapshot>("GET", "/__hui/providers");
const connection = async (hui: Hui) => (await snapshot(hui)).providers.find((entry) => entry.id === PROVIDER)!;
const accounts = async (hui: Hui) => (await connection(hui)).accounts.map(({ id, name, authenticated }) => ({ id, name, authenticated }));

/** The credential file HUI saves for one account, which a signed-in account is read from: removing it is how a
 * credential goes missing without PI's help (server/pi/provider-accounts.ts names both paths). */
const credential = (hui: Hui, account: string) => join(hui.configDir, "providers", account === "default" ? "auth.json" : join("accounts", account, "auth.json"));

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

test("a provider or account whose credential is gone reads Sign in to reconnect with only Sign in, and signing in again reuses the saved account and name", { tags: ["SET-039"], platforms: ["web"] }, async ({ screen, hui }) => {
  try {
    await openModels(screen, hui);
    await screen.getByRole("button", "Add provider").tap();
    await screen.getByRole("button", /^OpenAI /u).tap();
    await signIn(screen, "Personal");
    await expect(screen.getByText(ADDED, { exact: true })).toBeVisible();
    await screen.getByRole("button", "Add account").tap();
    await signIn(screen, "Work");
    await expect(screen.getByRole("article", { name: "Work" })).toBeVisible();
    const [personal, work] = await accounts(hui);
    expect([personal!.name, work!.name]).toEqual(["Personal", "Work"]);

    // One account loses its credential: the card keeps the other one, and Work reads signed out.
    await rm(credential(hui, work!.id));
    await hui.reload();
    const card = await providerCard(screen);
    const workRow = card.getByRole("article", { name: "Work" });
    await expect(workRow.getByText("Sign in to reconnect", { exact: true })).toBeVisible();
    await expect(workRow.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
    await expect(workRow.getByRole("button", { name: /^Reconnect$/u })).toHaveCount(0);
    await expect(workRow.getByText("Subscription and limits", { exact: true })).toHaveCount(0);
    await expect(card.getByText("Sign in to reconnect", { exact: true })).toHaveCount(1);

    // Signing that account in again reuses it: same id, same place in the priority list, same saved name.
    await workRow.getByRole("button", { name: "Sign in", exact: true }).tap();
    await expect(screen.getByRole("button", "Close provider dialog")).toBeVisible();
    await signIn(screen);
    await expect(screen.getByText(ADDED, { exact: true })).toBeVisible();
    expect(await accounts(hui)).toEqual([
      { id: personal!.id, name: "Personal", authenticated: true },
      { id: work!.id, name: "Work", authenticated: true },
    ]);
    await expect(card.getByRole("article", { name: "Work" })).toBeVisible();
    await expect(card.getByText("Sign in to reconnect", { exact: true })).toHaveCount(0);
    await expect(card.getByRole("article", { name: "Work" }).getByText("Subscription and limits", { exact: true })).toBeVisible();

    // Every credential gone: the card itself reads signed out with only Sign in, no accounts, limits or model list.
    for (const account of await accounts(hui)) await rm(credential(hui, account.id));
    await hui.reload();
    const signedOut = await providerCard(screen);
    await expect(signedOut.getByText("Sign in to reconnect", { exact: true })).toBeVisible();
    await expect(signedOut.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
    await expect(signedOut.getByRole("button", { name: "Add account" })).toHaveCount(0);
    await expect(signedOut.getByRole("button", { name: `Remove ${CARD}` })).toHaveCount(0);
    await expect(signedOut.getByRole("article")).toHaveCount(0);
    await expect(signedOut.getByText("Subscription and limits", { exact: true })).toHaveCount(0);
    await expect(signedOut.getByText("Choose models", { exact: true })).toHaveCount(0);
    expect((await connection(hui)).accounts.map(({ name, authenticated }) => ({ name, authenticated }))).toEqual([
      { name: "Personal", authenticated: false },
      { name: "Work", authenticated: false },
    ]);

    // The card reads the same again on the next visit.
    await hui.reload();
    await expect((await providerCard(screen)).getByText("Sign in to reconnect", { exact: true })).toBeVisible();
  } finally {
    await hui.api("DELETE", `/__hui/providers/${PROVIDER}`).catch(() => undefined);
  }
});
