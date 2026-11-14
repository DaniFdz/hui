/**
 * Settings → Models reorders account priority by dragging a grip: the picked account and the insertion line show while it
 * moves, the drop saves the new order for later visits, and a drop outside the accounts or a failed save keeps the last
 * confirmed order (SET-041).
 */
import { expect, type Locator, type Screen } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";

type Account = { id: string; name: string; authenticated: boolean };
type Provider = { id: string; configured: boolean; authenticated: boolean; accounts: Account[] };
type Snapshot = { providers: Provider[] };

const PROVIDER = "openai";
const CARD = "OpenAI · all GPT models";
const KEY = "sk-e2e-not-a-secret";
const ADDED = `${CARD} added. You can change its models any time.`;
/** The answer an OpenAI API-key account gets when the page asks for a subscription's limits: never a network read. */
const LIMITS = "This provider does not expose a supported subscription quota API.";

const order = async (hui: Hui) => ((await hui.api<Snapshot>("GET", "/__hui/providers")).providers.find((entry) => entry.id === PROVIDER)?.accounts ?? []).map(({ name }) => name);

/** Opens Settings → Models once its own settings have loaded, which its provider section waits for. */
const openModels = async (screen: Screen, hui: Hui) => {
  await hui.open("/settings/models");
  await expect(screen.getByText(/^Saved by HUI\./u)).toBeVisible({ timeout: 60_000 });
  await expect(screen.getByRole("button", "Connect a provider")).toBeVisible();
};

/** The page's provider card. Provider configuration starts folded on every visit and reload. */
const providerCard = async (screen: Screen) => {
  await screen.getByText("Provider configuration · 1 provider", { exact: true }).tap();
  const card = screen.getByRole("article", { name: CARD });
  await expect(card).toBeVisible();
  return card;
};

/** Submits the key and leaves the wizard's model step, which saves the one model it holds and closes the dialog. */
const signIn = async (screen: Screen, name?: string) => {
  if (name) await screen.getByLabel("Label when email is unavailable (optional)", { exact: true }).fill(name);
  await screen.getByRole("button", /^API key /u).tap();
  await screen.getByLabel("Enter OpenAI API key", { exact: true }).fill(KEY);
  await screen.getByRole("button", "Continue").tap();
  await expect(screen.getByText("Account connected. Choose a model when you want to test a reply.", { exact: true })).toBeVisible();
  const close = screen.getByRole("button", "Close provider dialog");
  await expect(close).toBeEnabled();
  await close.tap();
  await expect(close).toBeHidden();
};

/** The pixels from a grip's centre to the middle of another account's row, plus a margin that carries it past that
 * middle: where a pointer must be for the drag to name the new position. */
const offsetTo = async (grip: Locator, row: Locator, margin: number) => {
  const from = (await grip.boundingBox())!;
  const to = (await row.boundingBox())!;
  return Math.round(to.y + to.height / 2 - (from.y + from.height / 2)) + margin;
};

/** Waits until both rows have drawn their limits, so the rows no longer grow underneath a drag's measurements. */
const settled = async (screen: Screen) => {
  const card = screen.getByRole("article", { name: CARD });
  await expect(card.getByText(LIMITS, { exact: true })).toHaveCount(2);
};

test("dragging an account's grip shows the picked row and the insertion line, saves the new order for the next visit, and keeps the last confirmed order when the drop lands outside or the save fails", { tags: ["SET-041"], platforms: ["web"] }, async ({ screen, hui }) => {
  try {
    await openModels(screen, hui);
    await screen.getByRole("button", "Connect a provider").tap();
    await screen.getByRole("button", /^OpenAI /u).tap();
    await signIn(screen, "Personal");
    await expect(screen.getByText(ADDED, { exact: true })).toBeVisible();
    await screen.getByRole("button", "Add account").tap();
    await signIn(screen, "Work");
    await expect(screen.getByRole("article", { name: "Work" })).toBeVisible();
    expect(await order(hui)).toEqual(["Personal", "Work"]);
    await settled(screen);

    const card = screen.getByRole("article", { name: CARD });
    const rows = card.getByRole("article");
    const personal = card.getByRole("article", { name: "Personal" });
    const work = card.getByRole("article", { name: "Work" });

    // Dragging the first account's grip past the second row picks it up and marks where it would land.
    await hui.dragBy(screen.getByRole("button", { name: "Reorder Personal" }), { dx: 0, dy: await offsetTo(screen.getByRole("button", { name: "Reorder Personal" }), work, 12) }, async () => {
      await expect(screen.getByText("Personal, position 2 of 2.", { exact: true })).toBeVisible();
      await expect(personal).toHaveAttribute("class", /is-dragging/u);
      await expect(work).toHaveAttribute("class", /drop-after/u);
    });
    await expect(screen.getByText("Account priority saved.", { exact: true })).toBeVisible();
    expect(await order(hui)).toEqual(["Work", "Personal"]);
    await expect(rows.nth(0)).toHaveAccessibleName("Work");
    await expect(rows.nth(1)).toHaveAccessibleName("Personal");
    await expect(rows.nth(0).getByText("1.", { exact: true })).toBeVisible();
    await expect(rows.nth(1).getByText("2.", { exact: true })).toBeVisible();

    // The saved order is what the next visit draws.
    await hui.reload();
    await providerCard(screen);
    await settled(screen);
    const reopened = screen.getByRole("article", { name: CARD }).getByRole("article");
    await expect(reopened.nth(0)).toHaveAccessibleName("Work");
    await expect(reopened.nth(1)).toHaveAccessibleName("Personal");
    await expect(reopened.nth(0).getByText("Next to use", { exact: true })).toBeVisible();
    await expect(reopened.nth(1).getByText("Standby", { exact: true })).toBeVisible();

    // Letting go outside the accounts cancels the drag and keeps the saved order.
    await hui.dragBy(screen.getByRole("button", { name: "Reorder Work" }), { dx: 0, dy: 900 }, async () => {
      await expect(screen.getByText("Work, position 2 of 2.", { exact: true })).toBeVisible();
    });
    await expect(screen.getByText("Reordering cancelled.", { exact: true })).toBeVisible();
    await expect(screen.getByText("Account priority saved.", { exact: true })).toBeHidden();
    expect(await order(hui)).toEqual(["Work", "Personal"]);
    await expect(reopened.nth(0)).toHaveAccessibleName("Work");

    // A save that fails shows its reason and leaves the last confirmed order in place.
    const save = await hui.intercept("PUT", /\/__hui\/providers\/openai\/accounts$/u);
    const personalAgain = screen.getByRole("button", { name: "Reorder Personal" });
    await hui.dragBy(personalAgain, { dx: 0, dy: await offsetTo(personalAgain, screen.getByRole("article", { name: "Work" }), -12) }, async () => {
      await expect(screen.getByText("Personal, position 1 of 2.", { exact: true })).toBeVisible();
    });
    await save.arrived();
    await save.reject(500, "Account priority could not be saved.");
    await expect(screen.getByRole("alert").filter({ hasText: "Account priority could not be saved." })).toBeVisible();
    expect(await order(hui)).toEqual(["Work", "Personal"]);
    await expect(reopened.nth(0)).toHaveAccessibleName("Work");
    await expect(reopened.nth(1)).toHaveAccessibleName("Personal");
  } finally {
    await hui.api("DELETE", `/__hui/providers/${PROVIDER}`).catch(() => undefined);
  }
});
