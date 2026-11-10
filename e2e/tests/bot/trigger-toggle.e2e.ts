/** A trigger's switch, on its page and on the overview, turns it off so reports wake nobody and on again, and Delete
 * takes it off both and out of the bot's automation (BOT-054). */
import { expect } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";
import { panelOverview } from "./bot-panel.ts";

const makeBot = async (hui: Hui, name: string) =>
  (await hui.api<{ bot: { id: string; name: string } }>("POST", "/__hui/bots", { name, soul: "# Who I am\nA terse fixture bot.\n" })).bot;

const event = (id: string) => ({ id, summary: `review ${id}`, details: `RAW ${id}`, at: new Date().toISOString() });

test("a trigger's switch turns it off so its listener's reports wake nobody and on again, and Delete takes it off its page and the overview", { tags: ["BOT-054"], platforms: ["web"] }, async ({ screen, hui }) => {
  const bot = await makeBot(hui, "Switchy");
  const { hook } = await hui.api<{ hook: { path: string } }>("POST", `/__hui/bots/${bot.id}/triggers`, { name: "Reviews", prompt: "Look at it.", cooldownSeconds: 0 });
  const listed = async () => (await hui.api<{ triggers: { name: string; enabled: boolean }[] }>("GET", `/__hui/bots/${bot.id}/triggers`)).triggers;

  await hui.open(`/bots/${bot.id}`);
  const transcript = screen.getByTestId("transcript");
  await panelOverview(screen, "Switchy");
  await screen.getByRole("button", /^Reviews /u).tap();
  const off = screen.getByRole("switch", "Enable Reviews");
  await expect(off).toBeChecked();

  // Off on its page: the listener's report is refused and nothing reaches the chat.
  await hui.flip(off);
  await expect(off).toBeChecked({ checked: false });
  await expect.poll(async () => await listed()).toEqual([expect.objectContaining({ name: "Reviews", enabled: false })]);
  expect(await (async () => {
    try {
      await hui.api("POST", hook.path, { events: [event("off")] });
      return "accepted";
    } catch (error) {
      return String(error);
    }
  })()).toContain("answered 409");
  await expect(transcript.getByText("review off")).toHaveCount(0);

  // On again from the overview: its page says so and its listener's next report wakes the bot.
  await screen.getByRole("button", "Back to Switchy").tap();
  const overviewSwitch = screen.getByRole("switch", "Enable Reviews");
  await expect(overviewSwitch).toBeChecked({ checked: false });
  await hui.flip(overviewSwitch);
  await expect(overviewSwitch).toBeChecked();
  await expect.poll(async () => await listed()).toEqual([expect.objectContaining({ name: "Reviews", enabled: true })]);
  expect(await hui.api<{ status: string }>("POST", hook.path, { events: [event("on")] })).toEqual({ status: "fired" });
  await expect(transcript.getByText("review on").first()).toBeVisible();

  // Delete takes it off its page, the overview and the bot's triggers.
  await screen.getByRole("button", /^Reviews /u).tap();
  await screen.getByRole("button", "Delete Reviews").tap();
  await expect(screen.getByText(/^No triggers yet\. A trigger wakes Switchy when a listener you run reports something/u)).toBeVisible();
  await expect.poll(async () => await listed()).toEqual([]);
  await screen.getByRole("button", "Back to Switchy").tap();
  await expect(screen.getByText("No triggers yet. A trigger wakes Switchy when a listener you run reports an event.")).toBeVisible();
  await expect(screen.getByRole("switch", "Enable Reviews")).toHaveCount(0);
});
