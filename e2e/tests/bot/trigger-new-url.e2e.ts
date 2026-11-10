/** New URL replaces a trigger's URL, so the one its listener had is refused from then on (BOT-053). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";
import { panelOverview } from "./bot-panel.ts";

test("New URL replaces a trigger's URL and the old one is refused", { tags: ["BOT-053"], platforms: ["web"] }, async ({ screen, hui }) => {
  const { bot } = await hui.api<{ bot: { id: string } }>("POST", "/__hui/bots", { name: "Rotator", soul: "# Who I am\nA terse fixture bot.\n" });
  const created = await hui.api<{ hook: { path: string } }>("POST", `/__hui/bots/${bot.id}/triggers`, { name: "Reviews", prompt: "Look at it.", cooldownSeconds: 0 });
  const event = { id: "one", summary: "review one", at: new Date().toISOString() };

  await hui.open(`/bots/${bot.id}`);
  await hui.clipboardSpy();
  await panelOverview(screen, "Rotator");
  await screen.getByRole("button", /^Reviews (?:No report|Last fired|Never fired|Listener reported)/u).tap();
  await screen.getByRole("button", "New URL for Reviews").tap();
  await expect(screen.getByText("Reviews: its URL")).toBeVisible();
  const fresh = await hui.textOf(screen.getByLabel("URL of Reviews"));
  expect(fresh).not.toBe(created.hook.path);
  await screen.getByRole("button", "Copy").tap();
  await expect.poll(async () => await hui.clipboardWrites()).toEqual([fresh]);

  // The old URL is refused from then on, and the new one wakes the bot.
  await expect.poll(async () => {
    try {
      await hui.api("POST", created.hook.path, { events: [event] });
      return "accepted";
    } catch (error) {
      return String(error);
    }
  }).toContain("answered 404");
  expect(await hui.api<{ status: string }>("POST", new URL(fresh).pathname, { events: [event] })).toEqual({ status: "fired" });
  await expect(screen.getByTestId("transcript").getByText("review one").first()).toBeVisible();
  await screen.getByRole("button", "Done").tap();
  await expect(screen.getByText(/^Last fired just now/u)).toBeVisible({ timeout: 15_000 });
});
