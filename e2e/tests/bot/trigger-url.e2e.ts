/** Without triggers the Triggers page explains what a listener is and opens Add trigger with its fields; Add trigger shows
 * "<name>: its URL" once with Copy and Done, and the card then shows its filter, "Never fired · cooldown …", the URL's
 * first characters and "No report from the listener since the gateway started." (BOT-048). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";
import { panelOverview } from "./bot-panel.ts";

test("the Triggers page explains a listener and opens Add trigger, whose Add shows its URL once with Copy and Done, and the card keeps its filter, its cooldown, the URL's start and no report yet", { tags: ["BOT-048"], platforms: ["web"] }, async ({ screen, hui }) => {
  const bot = (await hui.api<{ bot: { id: string } }>("POST", "/__hui/bots", { name: "Listener", soul: "# Who I am\nA terse fixture bot.\n" })).bot;
  // The clipboard spy arrives with the next page the browser loads.
  await hui.clipboard();
  await hui.open(`/bots/${bot.id}`);
  const panel = await panelOverview(screen, "Listener");
  await screen.getByRole("button", "Add trigger").tap();
  await expect(panel.getByRole("region", "Triggers")).toBeVisible();
  await expect(screen.getByText(/^No triggers yet\. A trigger wakes Listener when a listener you run reports something/u)).toBeVisible();

  expect(await screen.getByPlaceholder("Reviews").isVisible()).toBe(true);
  await expect(screen.getByLabel("Event field")).toBeVisible();
  await expect(screen.getByLabel("Comparison")).toBeVisible();
  await expect(screen.getByLabel("Value")).toBeVisible();
  await expect(screen.getByRole("checkbox", "Only events that link a GitHub pull request")).toBeChecked({ checked: false });
  await expect(screen.getByRole("checkbox", "Also events it marks as from outside your organization")).toBeChecked({ checked: false });
  await expect(screen.getByRole("checkbox", "Also events it marks as from bots and apps")).toBeChecked({ checked: false });
  await expect(screen.getByLabel("Cooldown")).toHaveValue("300");

  await screen.getByPlaceholder("Reviews").fill("Reviews");
  await screen.getByLabel("Event field").fill("fields.channel");
  await screen.getByLabel("Value").fill("C0123ABCD");
  await screen.getByPlaceholder("What should Listener do when it fires?").fill("Take a look at it.");
  await screen.getByRole("button", "Add trigger").tap();

  await expect(screen.getByText("Reviews: its URL")).toBeVisible();
  const shown = await screen.getByLabel("URL of Reviews").textContent();
  expect(shown).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/__hui\/hooks\/[A-Za-z0-9_-]{43}$/u);
  const hook = (await hui.api<{ triggers: { id: string; tokenHint: string }[] }>("GET", `/__hui/bots/${bot.id}/triggers`)).triggers[0]!;
  expect(shown!.split("/").at(-1)!.slice(0, 4)).toBe(hook.tokenHint);

  await hui.clipboard();
  await screen.getByRole("button", "Copy").tap();  await expect(screen.getByRole("button", "Copied")).toBeVisible();
  await expect.poll(() => hui.copied()).toBe(shown);
  await screen.getByRole("button", "Done").tap();
  await expect(screen.getByText("Reviews: its URL")).toHaveCount(0);

  const card = screen.getByRole("list", "Triggers");
  await expect(card.getByText('fields.channel equals "C0123ABCD"')).toBeVisible();
  await expect(card.getByText(/^Never fired · cooldown 5 min/u)).toBeVisible();
  await expect(card.getByText(new RegExp(`^URL …/hooks/${hook.tokenHint}… · shown when it was made$`, "u"))).toBeVisible();
  await expect(card.getByText("No report from the listener since the gateway started.")).toBeVisible();
});
