/** Settings → Models account priority and the models a connection offers: removing the connection (SET-038), adding and removing accounts (SET-043) and choosing the models a provider offers (SET-037). */
import { expect, type Screen } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";

type Provider = { id: string; configured: boolean; authenticated: boolean; accounts: { id: string; name: string }[]; selected: string[]; models: { id: string; name: string; contextWindow?: number; maxTokens?: number }[] };
type Snapshot = { providers: Provider[] };
type Pi = { model: { catalog: { provider: string; id: string; name: string }[] } };

/** OpenAI's API-key sign-in asks PI for the key and saves it locally, so a card can be added without a live provider. */
const PROVIDER = "openai";
const KEY = "sk-e2e-not-a-secret";

const snapshot = (hui: Hui) => hui.api<Snapshot>("GET", "/__hui/providers");
const configured = async (hui: Hui, id = PROVIDER) => (await snapshot(hui)).providers.find((provider) => provider.id === id);
/** Leaves the run without a connection a failed test could not remove. */
const disconnect = (hui: Hui) => hui.api("DELETE", `/__hui/providers/${PROVIDER}`).catch(() => undefined);
/** The model labels the picker draws for a provider's catalog. */
const labels = (models: Provider["models"]) => models.map((model) =>
  `${model.name} ${model.id} Context: ${model.contextWindow?.toLocaleString() ?? "reported during the session"} · Max output: ${model.maxTokens?.toLocaleString() ?? "CLI-managed"}`);

/** The PI-ready page replaces the loading page's provider section, folding its disclosures. */
const modelsReady = async (screen: Screen) => {
  await expect(screen.getByText(/^Saved by HUI\./u)).toBeVisible({ timeout: 60_000 });
  await expect(screen.getByRole("button", "Add provider")).toBeVisible();
  await expect(screen.getByRole("button", "Add provider")).toBeEnabled();
};

/** Opens Settings → Models once both PI and the final provider section have loaded. */
const openModels = async (screen: Screen, hui: Hui) => {
  await hui.open("/settings/models");
  await modelsReady(screen);
};

/** Signs one account in with an API key in the dialog the page has open. */
const signIn = async (screen: Screen, name: string, key: string) => {
  await screen.getByLabel("Label when email is unavailable (optional)", { exact: true }).fill(name);
  await screen.getByRole("button", /^API key /u).tap();
  await screen.getByLabel("Enter OpenAI API key", { exact: true }).fill(key);
  await screen.getByRole("button", "Continue").tap();
  await expect(screen.getByRole("button", "Close provider dialog")).toBeHidden();
};

/** Adds the provider connection from Settings → Models and returns the notices it showed. */
const addProvider = async (screen: Screen, hui: Hui, name: string) => {
  await openModels(screen, hui);
  await screen.getByRole("button", "Add provider").tap();
  await screen.getByRole("button", /^OpenAI /u).tap();
  await signIn(screen, name, KEY);
  await expect(screen.getByText(`OpenAI · API key added. Choose the models you want to use.`, { exact: true })).toBeVisible();
};

const addAccount = async (screen: Screen, name: string, key: string) => {
  await screen.getByRole("button", "Add account").tap();
  await signIn(screen, name, key);
};

test("Remove asks before dropping a provider connection, Keep connection leaves it, and Confirm removal keeps the models PI configures itself", { tags: ["SET-038"], platforms: ["web"] }, async ({ screen, hui }) => {
  const page = screen.getByTestId("settings-page");
  const pi = await hui.api<Pi>("GET", "/__hui/pi");
  try {
    await addProvider(screen, hui, "Personal");
    const remove = screen.getByRole("button", "Remove OpenAI · API key");
    await expect(remove).toBeVisible();

    await remove.tap();
    await expect(screen.getByText("Remove this HUI connection and its saved credentials? PI configuration is kept. Existing sessions keep their current runtime until reopened.", { exact: true })).toBeVisible();
    await screen.getByRole("button", "Keep connection").tap();
    await expect(screen.getByText("Remove this HUI connection and its saved credentials? PI configuration is kept. Existing sessions keep their current runtime until reopened.", { exact: true })).toBeHidden();
    await expect(screen.getByText("Credentials available", { exact: true })).toBeVisible();
    expect((await configured(hui))?.authenticated).toBe(true);

    await remove.tap();
    await screen.getByRole("button", "Confirm removal").tap();
    await expect(screen.getByText("Connection removed. PI configuration is unchanged.", { exact: true })).toBeVisible();
    await expect(screen.getByRole("article", { name: "OpenAI · API key" })).toBeHidden();
    await expect(page.getByText("No providers added yet. Add one to get started.", { exact: true })).toBeVisible();
    expect((await configured(hui))?.configured).toBe(false);
  } finally {
    await disconnect(hui);
  }
  // The models PI's own models.json configures still reach the pickers.
  expect((await hui.api<Pi>("GET", "/__hui/pi")).model.catalog).toEqual(pi.model.catalog);
});

test("Remove account asks to confirm, Keep account cancels, and Confirm removal keeps the other accounts and the selected models", { tags: ["SET-043"], platforms: ["web"] }, async ({ screen, hui }) => {
  try {
    await addProvider(screen, hui, "Personal");
    await addAccount(screen, "Work", "sk-e2e-work-not-a-secret");
    await expect(screen.getByRole("article", { name: "Personal" })).toBeVisible();
    await expect(screen.getByRole("article", { name: "Work" })).toBeVisible();

    // Save a model selection, so the removal has selections to keep.
    await screen.getByText("Models Choose models", { exact: true }).tap();
    const [first, second] = (await configured(hui))!.models;
    await screen.getByRole("checkbox", labels([first!])[0]!, { exact: true }).tap();
    await screen.getByRole("checkbox", labels([second!])[0]!, { exact: true }).tap();
    await screen.getByRole("button", "Save models").tap();
    await expect(screen.getByText("Model selection saved.", { exact: true })).toBeVisible();
    await expect(screen.getByText("Models 2 selected", { exact: true })).toBeVisible();

    const remove = screen.getByRole("button", "Remove account Work");
    await remove.tap();
    await expect(screen.getByText("Remove Work? Other accounts and model selections are kept.", { exact: true })).toBeVisible();
    await screen.getByRole("button", "Keep account").tap();
    await expect(screen.getByText("Remove Work? Other accounts and model selections are kept.", { exact: true })).toBeHidden();
    await expect(screen.getByRole("article", { name: "Work" })).toBeVisible();

    await remove.tap();
    await screen.getByRole("button", "Confirm removal").tap();
    await expect(screen.getByText("Account removed.", { exact: true })).toBeVisible();
    await expect(screen.getByRole("article", { name: "Work" })).toBeHidden();
    await expect(screen.getByRole("article", { name: "Personal" })).toBeVisible();
    await expect(screen.getByText("Models 2 selected", { exact: true })).toBeVisible();
    const left = (await configured(hui))!;
    expect(left.accounts.map((account) => account.name)).toEqual(["Personal"]);
    expect(left.selected).toEqual([first!.id, second!.id]);
  } finally {
    await disconnect(hui);
  }
});

test("a provider's Models disclosure lists its models with their limits, filters them, selects and clears them, saves the choice and discards a cancelled draft", { tags: ["SET-037"], platforms: ["web"] }, async ({ screen, hui }) => {
  try {
    await addProvider(screen, hui, "Personal");
    const catalog = (await configured(hui))!.models;
    const list = screen.getByRole("checkbox");
    const count = () => list.count();
    const matching = (query: string) => catalog.filter((model) => `${model.id} ${model.name}`.toLocaleLowerCase().includes(query));
    const disclose = () => screen.getByText("Provider configuration · 1 provider", { exact: true }).tap();

    await screen.getByText("Models Choose models", { exact: true }).tap();
    // Every model of the provider is listed, each with its context and output limits.
    await expect.poll(count).toBe(catalog.length);
    for (const model of [catalog[0]!, catalog.at(-1)!]) await expect(screen.getByRole("checkbox", labels([model])[0]!, { exact: true })).toBeVisible();

    // The filter keeps the models whose name or id matches.
    const search = screen.getByLabel("Search OpenAI · API key models", { exact: true });
    const matches = matching("gpt-4o-mini");
    await search.fill("gpt-4o-mini");
    await expect.poll(count).toBe(matches.length);
    await expect(screen.getByRole("checkbox", labels([matches[0]!])[0]!, { exact: true })).toBeVisible();

    // Select visible takes the listed models and Clear selection empties the draft.
    await screen.getByRole("button", "Select visible").tap();
    await expect(screen.getByText(`Models ${matches.length} selected`, { exact: true })).toBeVisible();
    await expect(screen.getByRole("checkbox", { checked: true })).toHaveCount(matches.length);
    await screen.getByRole("button", "Clear selection").tap();
    await expect(screen.getByText("Models Choose models", { exact: true })).toBeVisible();

    // Save models keeps the chosen models as the provider's selection.
    const [first, second] = catalog;
    await search.fill("");
    await expect.poll(count).toBe(catalog.length);
    await screen.getByRole("checkbox", labels([first!])[0]!, { exact: true }).tap();
    await screen.getByRole("checkbox", labels([second!])[0]!, { exact: true }).tap();
    await screen.getByRole("button", "Save models").tap();
    await expect(screen.getByText("Model selection saved.", { exact: true })).toBeVisible();
    await expect(screen.getByText("Models 2 selected", { exact: true })).toBeVisible();
    await expect(search).toBeHidden();
    expect((await configured(hui))!.selected).toEqual([first!.id, second!.id]);

    // The provider card can arrive before PI. Wait for the final page before opening its disclosure.
    const piRead = await hui.intercept("GET", /\/__hui\/pi$/u);
    await hui.reload();
    await piRead.arrived();
    await expect(screen.getByText("Provider configuration · 1 provider", { exact: true })).toBeVisible();
    await expect(screen.getByText("Reading pi configuration…", { exact: true })).toBeVisible();
    await piRead.deliver();
    await modelsReady(screen);
    await disclose();
    await expect(screen.getByText("Models 2 selected", { exact: true })).toBeVisible();
    expect((await configured(hui))!.selected).toEqual([first!.id, second!.id]);

    // A cancelled draft discards what was picked.
    await screen.getByText("Models 2 selected", { exact: true }).tap();
    await screen.getByRole("button", "Select visible").tap();
    await expect(screen.getByText(`Models ${catalog.length} selected`, { exact: true })).toBeVisible();
    await screen.getByRole("button", "Cancel").tap();
    await expect(screen.getByText("Models 2 selected", { exact: true })).toBeVisible();
    expect((await configured(hui))!.selected).toEqual([first!.id, second!.id]);

    // Only the saved models reach the model pickers.
    const offered = (await hui.api<Pi>("GET", "/__hui/pi")).model.catalog.filter((model) => model.provider === PROVIDER);
    expect(offered.map((model) => model.id).toSorted()).toEqual([first!.id, second!.id].toSorted());
    await hui.open("/");
    await screen.getByLabel(/^Model: /u).first().tap();
    await expect(screen.getByText(first!.name, { exact: true }).first()).toBeVisible();
    await expect(screen.getByText(catalog[2]!.name, { exact: true })).toHaveCount(0);
  } finally {
    await disconnect(hui);
  }
});
