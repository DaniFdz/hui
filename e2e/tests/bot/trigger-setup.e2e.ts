/** A trigger's add form and the card it leaves behind: what it watches, the URL shown once with Copy and Done, and
 * what the card says while no listener has reported (BOT-048); and New URL, after which the old URL is refused
 * (BOT-053). */
import { expect } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";
import { panelOverview } from "./bot-panel.ts";

const makeBot = async (hui: Hui, name: string) =>
  (await hui.api<{ bot: { id: string } }>("POST", "/__hui/bots", { name, soul: "# Who I am\nA terse fixture bot.\n" })).bot;

const event = (id: string) => ({ id, summary: `review ${id}`, details: `RAW ${id}`, at: new Date().toISOString() });

test("Add trigger takes its name, filter, options, prompt and cooldown, shows its URL once with Copy and Done, and the card says what it watches while no listener has reported", { tags: ["BOT-048"], platforms: ["web"] }, async ({ screen, hui }) => {
  const bot = await makeBot(hui, "Watcher");
  await hui.clipboard();
  await hui.open(`/bots/${bot.id}`);
  await panelOverview(screen, "Watcher");

  // The overview's + opens the Triggers page on its add form.
  await screen.getByRole("button", "Add trigger").tap();
  await expect(screen.getByRole("region", "Triggers")).toBeVisible();
  await expect(screen.getByText(/^No triggers yet\. A trigger wakes Watcher when a listener you run reports something: a program that watches what HUI doesn't read itself/u)).toBeVisible();
  await expect(screen.getByPlaceholder("Reviews")).toBeVisible();
  await expect(screen.getByPlaceholder("fields.channel")).toBeVisible();
  await expect(screen.getByPlaceholder("C0123ABCD")).toBeVisible();
  await expect(screen.getByRole("checkbox", "Only events that link a GitHub pull request")).toBeVisible();
  await expect(screen.getByRole("checkbox", "Also events it marks as from outside your organization")).toBeVisible();
  await expect(screen.getByRole("checkbox", "Also events it marks as from bots and apps")).toBeVisible();
  await expect(screen.getByPlaceholder("What should Watcher do when it fires?")).toBeVisible();
  const cooldowns = await hui.textOf(screen.getByLabel("Cooldown"));
  for (const choice of ["None", "1 min", "5 min", "15 min", "1 h"]) expect(cooldowns).toContain(choice);

  await screen.getByPlaceholder("Reviews").fill("Reviews");
  await screen.getByPlaceholder("fields.channel").fill("fields.channel");
  await screen.getByPlaceholder("C0123ABCD").fill("C0123");
  await screen.getByRole("checkbox", "Only events that link a GitHub pull request").check();
  await screen.getByRole("checkbox", "Also events it marks as from outside your organization").check();
  await screen.getByRole("checkbox", "Also events it marks as from bots and apps").check();
  await screen.getByPlaceholder("What should Watcher do when it fires?").fill("Look at it.");
  await screen.getByLabel("Cooldown").selectOption({ label: "5 min" });
  await screen.getByRole("button", "Add trigger").tap();

  // The URL comes once, with Copy and Done; the page keeps only a fingerprint of it.
  await expect(screen.getByText("Reviews: its URL")).toBeVisible();
  await expect(screen.getByText(/^Copy it now: HUI keeps only a fingerprint of it and can't show it again\./u)).toBeVisible();
  const shown = (await screen.getByLabel("URL of Reviews").textContent()) ?? "";
  expect(shown).toMatch(/^http:\/\/[^/]+\/__hui\/hooks\/[A-Za-z0-9_-]{43}$/u);
  await screen.getByRole("button", "Copy").tap();
  await expect(screen.getByRole("button", "Copied")).toBeVisible();
  expect(await hui.copied()).toBe(shown);
  await screen.getByRole("button", "Done").tap();
  await expect(screen.getByText("Reviews: its URL")).toBeHidden();

  // The card: its filter, never fired with its cooldown, the URL's first characters only, and no listener heard from.
  const card = screen.getByRole("list", "Triggers").getByRole("listitem").filter({ hasText: "Reviews" });
  await expect(card.getByText('fields.channel equals "C0123" · PR links only · outsiders too · bots too')).toBeVisible();
  await expect(card.getByText(/^Never fired · cooldown 5 min · steers with summaries and links$/u)).toBeVisible();
  await expect(card.getByText("Look at it.")).toBeVisible();
  await expect(card.getByText(`URL …/hooks/${shown.split("/").at(-1)!.slice(0, 4)}… · shown when it was made`)).toBeVisible();
  await expect(card.getByText("No report from the listener since the gateway started.")).toBeVisible();
  await expect(screen.getByText("0 of 12 trigger deliveries in the last hour.")).toBeVisible();

  // Once dismissed, a reload shows the card alone: the URL is never shown again.
  await hui.reload();
  const panel = await panelOverview(screen, "Watcher");
  await panel.getByRole("button", "Add trigger").tap();
  await expect(screen.getByRole("region", "Triggers")).toBeVisible();
  await expect(screen.getByText("Reviews: its URL")).toBeHidden();
  await expect(screen.getByLabel("URL of Reviews")).toBeHidden();
  await expect(screen.getByRole("list", "Triggers").getByText(/^Never fired · cooldown 5 min/u)).toBeVisible();
});

test("New URL shows a fresh URL once with Copy, and the old URL is refused from then on", { tags: ["BOT-053"], platforms: ["web"] }, async ({ screen, hui }) => {
  const bot = await makeBot(hui, "Relay");
  const { hook } = await hui.api<{ hook: { path: string } }>("POST", `/__hui/bots/${bot.id}/triggers`, { name: "Reviews", prompt: "Look at it.", cooldownSeconds: 0 });
  await hui.clipboard();
  await hui.open(`/bots/${bot.id}`);
  await panelOverview(screen, "Relay");
  await screen.getByRole("button", "Add trigger").tap();
  await expect(screen.getByRole("list", "Triggers").getByText("Never fired · cooldown none", { exact: false })).toBeVisible();

  await screen.getByRole("button", "New URL for Reviews").tap();
  await expect(screen.getByText("Reviews: its URL")).toBeVisible();
  const fresh = (await screen.getByLabel("URL of Reviews").textContent()) ?? "";
  expect(fresh).toMatch(/^http:\/\/[^/]+\/__hui\/hooks\/[A-Za-z0-9_-]{43}$/u);
  expect(new URL(fresh).pathname).not.toBe(hook.path);
  await screen.getByRole("button", "Copy").tap();
  await expect(screen.getByRole("button", "Copied")).toBeVisible();
  expect(await hui.copied()).toBe(fresh);

  // The old URL is gone; the fresh one wakes the bot.
  const refused = await hui.api("POST", hook.path, { events: [event("old")] }).then(() => "", (error: Error) => error.message);
  expect(refused).toContain("404");
  expect(refused).toContain("No trigger has this URL.");
  await hui.api("POST", new URL(fresh).pathname, { events: [event("new")] });

  // The card keeps the new URL's first characters, and the delivery reaches the chat.
  const card = screen.getByRole("list", "Triggers").getByRole("listitem").filter({ hasText: "Reviews" });
  await expect(card.getByText(`URL …/hooks/${fresh.split("/").at(-1)!.slice(0, 4)}… · shown when it was made`)).toBeVisible();
  await expect(screen.getByTestId("transcript").getByText(/review new/u).first()).toBeVisible();
});
