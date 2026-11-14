/**
 * Settings → Models reorders account priority from the keyboard: Space picks a grip up, arrow keys and Home/End choose a
 * position as each move is announced, Space or Enter drops it with focus kept on the moved account, and Escape or Tab
 * cancels without saving (SET-042).
 */
import { expect, type Screen } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";

type Account = { id: string; name: string; authenticated: boolean };
type Provider = { id: string; configured: boolean; accounts: Account[] };
type Snapshot = { providers: Provider[] };

const PROVIDER = "openai";
const CARD = "OpenAI · all GPT models";
const KEY = "sk-e2e-not-a-secret";
const ADDED = `${CARD} added. You can change its models any time.`;
const PICKED_UP = "Picked up Personal. Use arrow keys to choose a position, Space to drop, or Escape to cancel.";

const order = async (hui: Hui) => ((await hui.api<Snapshot>("GET", "/__hui/providers")).providers.find((entry) => entry.id === PROVIDER)?.accounts ?? []).map(({ name }) => name);

/** Opens Settings → Models once its own settings have loaded, which its provider section waits for. */
const openModels = async (screen: Screen, hui: Hui) => {
  await hui.open("/settings/models");
  await expect(screen.getByText(/^Saved by HUI\./u)).toBeVisible({ timeout: 60_000 });
  await expect(screen.getByRole("button", "Connect a provider")).toBeVisible();
};

/** Submits the key and leaves the wizard's model step, which saves the one model it holds and closes the dialog. */
const signIn = async (screen: Screen, name: string) => {
  await screen.getByLabel("Label when email is unavailable (optional)", { exact: true }).fill(name);
  await screen.getByRole("button", /^API key /u).tap();
  await screen.getByLabel("Enter OpenAI API key", { exact: true }).fill(KEY);
  await screen.getByRole("button", "Continue").tap();
  await expect(screen.getByText("Account connected. Choose a model when you want to test a reply.", { exact: true })).toBeVisible();
  const close = screen.getByRole("button", "Close provider dialog");
  await expect(close).toBeEnabled();
  await close.tap();
  await expect(close).toBeHidden();
};

test("a focused grip picks an account up with Space, arrow keys and Home/End choose the announced position, Space or Enter drops it with focus kept, and Escape or Tab cancels", { tags: ["SET-042"], platforms: ["web"] }, async ({ screen, hui }) => {
  try {
    await openModels(screen, hui);
    await screen.getByRole("button", "Connect a provider").tap();
    await screen.getByRole("button", /^OpenAI /u).tap();
    await signIn(screen, "Personal");
    await expect(screen.getByText(ADDED, { exact: true })).toBeVisible();
    await screen.getByRole("button", "Add account").tap();
    await signIn(screen, "Work");
    expect(await order(hui)).toEqual(["Personal", "Work"]);

    const card = screen.getByRole("article", { name: CARD });
    const personal = screen.getByRole("button", { name: "Reorder Personal" });
    const work = screen.getByRole("button", { name: "Reorder Work" });
    const announcement = (text: string) => expect(screen.getByText(text, { exact: true })).toBeVisible();

    // Space picks the first account up and says how to place it.
    await personal.press("Space");
    await announcement(PICKED_UP);
    await expect(personal).toHaveAttribute("aria-pressed", "true");
    await expect(card.getByRole("article", { name: "Personal" })).toHaveAttribute("class", /is-dragging/u);

    // Each move names the position it would land in.
    await personal.press("ArrowDown");
    await announcement("Personal, position 2 of 2.");
    await personal.press("Home");
    await announcement("Personal, position 1 of 2.");
    await personal.press("End");
    await announcement("Personal, position 2 of 2.");

    // Space drops it, the new order is saved and focus stays on the moved account.
    await personal.press("Space");
    await expect(screen.getByText("Account priority saved.", { exact: true })).toBeVisible();
    expect(await order(hui)).toEqual(["Work", "Personal"]);
    await expect(personal).toBeFocused();
    await expect(personal).toHaveAttribute("aria-pressed", "false");

    // Enter picks up and drops the same way: the second account goes back to the front.
    await personal.press("Enter");
    await announcement("Picked up Personal. Use arrow keys to choose a position, Space to drop, or Escape to cancel.");
    await personal.press("ArrowUp");
    await announcement("Personal, position 1 of 2.");
    await personal.press("Enter");
    await expect(screen.getByText("Account priority saved.", { exact: true })).toBeVisible();
    expect(await order(hui)).toEqual(["Personal", "Work"]);
    await expect(personal).toBeFocused();

    // Escape cancels: the move is announced, then dropped without a save.
    await work.press("Space");
    await expect(screen.getByText("Picked up Work. Use arrow keys to choose a position, Space to drop, or Escape to cancel.", { exact: true })).toBeVisible();
    await work.press("ArrowUp");
    await announcement("Work, position 1 of 2.");
    await work.press("Escape");
    await expect(screen.getByText("Reordering cancelled.", { exact: true })).toBeVisible();
    expect(await order(hui)).toEqual(["Personal", "Work"]);

    // Tab cancels the same way.
    await work.press("Space");
    await work.press("ArrowUp");
    await announcement("Work, position 1 of 2.");
    await work.press("Tab");
    await expect(screen.getByText("Reordering cancelled.", { exact: true })).toBeVisible();
    expect(await order(hui)).toEqual(["Personal", "Work"]);
    await expect(card.getByRole("article").nth(0)).toHaveAccessibleName("Personal");
    await expect(card.getByRole("article").nth(1)).toHaveAccessibleName("Work");
  } finally {
    await hui.api("DELETE", `/__hui/providers/${PROVIDER}`).catch(() => undefined);
  }
});
