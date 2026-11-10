/** A listener's report that passes a trigger's filter puts one message in the bot's chat as the trigger's, with a line
 * for each pull request it links, says "Last fired just now", records the run as Fired, and neither the same report
 * again nor an event the filter leaves out wakes the bot (BOT-049). */
import { expect } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";
import { panelOverview } from "./bot-panel.ts";

const makeBot = async (hui: Hui, name: string) =>
  (await hui.api<{ bot: { id: string; name: string; sessionId: string } }>("POST", "/__hui/bots", { name, soul: "# Who I am\nA terse fixture bot.\n" })).bot;

/** An event for a channel the trigger's filter passes, or one it leaves out. */
const event = (id: string, summary: string, channel = "C0123ABCD") => ({
  id, summary, details: `RAW ${summary}`, at: new Date().toISOString(), fields: { channel }, links: ["https://github.com/acme/web/pull/12"],
});

test("a report that passes a trigger's filter wakes the bot as the trigger with its pull request, and the same report or a filtered-out event wakes nobody", { tags: ["BOT-049"], platforms: ["web"] }, async ({ screen, hui }) => {
  const bot = await makeBot(hui, "Waker");
  const { hook } = await hui.api<{ hook: { path: string } }>("POST", `/__hui/bots/${bot.id}/triggers`, {
    name: "Reviews", prompt: "Look at it.", cooldownSeconds: 0,
    filter: { match: { field: "fields.channel", op: "equals", value: "C0123ABCD" } },
  });
  const runs = async () => (await hui.api<{ runs: { triggerName: string; status: string; summary: string }[] }>("GET", `/__hui/bots/${bot.id}/triggers`)).runs;

  await hui.open(`/bots/${bot.id}`);
  const transcript = screen.getByTestId("transcript");
  expect(await hui.api<{ status: string }>("POST", hook.path, { events: [event("one", "review one")] })).toEqual({ status: "fired" });

  // One message, as the trigger's: its name, and its summary where the sender's role goes.
  await expect(transcript.getByText("review one").first()).toBeVisible();
  await expect(transcript.getByText("Reviews").first()).toBeVisible();
  // The pull request it links shows as its own line under the message.
  await expect(transcript.getByRole("list", "GitHub links").getByText("acme/web#12")).toBeVisible();
  await expect(transcript.getByText("Fixture response.")).toBeVisible();

  // Its card says when it last fired, and its run reads Fired with the event's summary.
  await panelOverview(screen, "Waker");
  await screen.getByRole("button", /^Reviews /u).tap();
  await expect(screen.getByText(/^Last fired just now · cooldown none · steers with summaries and links$/u)).toBeVisible({ timeout: 15_000 });
  await expect(screen.getByText("Latest trigger runs")).toBeVisible();
  await expect(screen.getByText("Fired", { exact: true })).toBeVisible();
  expect(await runs()).toEqual([expect.objectContaining({ triggerName: "Reviews", status: "fired", summary: "review one" })]);

  // The same report again wakes nobody: its id was delivered once.
  expect(await hui.api<{ status: string }>("POST", hook.path, { events: [event("one", "review one")] })).toEqual({ status: "ignored" });
  await expect(transcript.getByText("review one")).toHaveCount(1);
  expect(await runs()).toHaveLength(1);

  // So does an event the filter leaves out.
  expect(await hui.api<{ status: string }>("POST", hook.path, { events: [event("two", "review two", "C9999")] })).toEqual({ status: "ignored" });
  await expect(transcript.getByText("review two")).toHaveCount(0);
  await expect(transcript.getByText("review one")).toHaveCount(1);
  expect(await runs()).toHaveLength(1);
});
