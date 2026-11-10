/** Events that arrive within a trigger's cooldown wait on its card and reach the chat as one delivery the run calls
 * Coalesced, and past the bot's hourly cap they wait instead of being dropped (BOT-051). */
import { expect } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";
import { panelOverview } from "./bot-panel.ts";

const makeBot = async (hui: Hui, name: string) =>
  (await hui.api<{ bot: { id: string; name: string } }>("POST", "/__hui/bots", { name, soul: "# Who I am\nA terse fixture bot.\n" })).bot;

const event = (id: string) => ({ id, summary: `review ${id}`, details: `RAW ${id}`, at: new Date().toISOString() });

test("events within a trigger's cooldown wait on its card and arrive as one Coalesced delivery, and past the hourly cap they wait instead of being dropped", { tags: ["BOT-051"], platforms: ["web"] }, async ({ screen, hui }) => {
  const bot = await makeBot(hui, "Burner");
  // Five seconds is the shortest cooldown the page can show as a wait: the panel rereads its triggers every five.
  const { hook } = await hui.api<{ hook: { path: string } }>("POST", `/__hui/bots/${bot.id}/triggers`, { name: "Reviews", prompt: "Look at it.", cooldownSeconds: 8 });

  await hui.open(`/bots/${bot.id}`);
  const transcript = screen.getByTestId("transcript");
  await panelOverview(screen, "Burner");
  await screen.getByRole("button", /^Reviews /u).tap();

  // One report of three events: the first goes at once, the two the cooldown holds wait on the card.
  expect(await hui.api<{ status: string }>("POST", hook.path, { events: [event("a"), event("b"), event("c")] })).toEqual({ status: "fired" });
  await expect(screen.getByText(/^2 events wait, sent together at .+$/u)).toBeVisible({ timeout: 20_000 });

  // Once the cooldown ends they arrive together, listed, and the run reads Coalesced.
  const delivered = transcript.getByText("2 events within 8 s");
  await expect(delivered).toHaveCount(1, { timeout: 20_000 });
  await expect(transcript.getByText(/review b/u).first()).toBeVisible();
  await expect(transcript.getByText(/review c/u).first()).toBeVisible();
  await expect(screen.getByText("Coalesced", { exact: true })).toBeVisible({ timeout: 20_000 });
  const listed = async () => (await hui.api<{ runs: { status: string; events: number }[]; deliveries: { lastHour: number; perHour: number } }>("GET", `/__hui/bots/${bot.id}/triggers`));
  expect((await listed()).deliveries).toEqual({ lastHour: 2, perHour: 12 });
  expect((await listed()).runs.map((run) => [run.status, run.events])).toEqual([["coalesced", 2], ["fired", 1]]);

  // Without a cooldown each report is its own delivery, until the bot has taken the twelve an hour it may.
  await hui.api("PATCH", `/__hui/bots/${bot.id}/triggers/Reviews`, { cooldownSeconds: 0 });
  for (const id of ["d", "e", "f", "g", "h", "i", "j", "k", "l", "m"]) {
    expect(await hui.api<{ status: string }>("POST", hook.path, { events: [event(id)] })).toEqual({ status: "fired" });
  }
  await expect(screen.getByText("12 of 12 trigger deliveries in the last hour.")).toBeVisible({ timeout: 20_000 });

  // The next event waits for a free slot rather than being dropped, and says when it goes.
  expect(await hui.api<{ status: string }>("POST", hook.path, { events: [event("n")] })).toEqual({ status: "held" });
  await expect(screen.getByText(/^1 event waits, sent together at .+$/u)).toBeVisible({ timeout: 20_000 });
  await expect(transcript.getByText(/review n/u)).toHaveCount(0);
  expect((await listed()).deliveries).toEqual({ lastHour: 12, perHour: 12 });
});
