/** Test sends a sample event into the bot's chat as the trigger's and says it was sent; a test the gateway refuses
 * shows its reason instead of claiming anything was sent (BOT-052). */
import { expect } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";
import { panelOverview } from "./bot-panel.ts";

const makeBot = async (hui: Hui, name: string) =>
  (await hui.api<{ bot: { id: string; name: string } }>("POST", "/__hui/bots", { name, soul: "# Who I am\nA terse fixture bot.\n" })).bot;

test("Test puts a sample event in the bot's chat as the trigger's and says it was sent, and says why when it can't reach the bot", { tags: ["BOT-052"], platforms: ["web"] }, async ({ screen, hui }) => {
  const bot = await makeBot(hui, "Sampler");
  await hui.api("POST", `/__hui/bots/${bot.id}/triggers`, { name: "Reviews", prompt: "Look at it.", cooldownSeconds: 0 });

  await hui.open(`/bots/${bot.id}`);
  await panelOverview(screen, "Sampler");
  await screen.getByRole("button", /^Reviews (?:No report|Last fired|Never fired|Listener reported)/u).tap();
  await screen.getByRole("button", "Test Reviews").tap();

  await expect(screen.getByText("Sent a test event to Sampler's chat.")).toBeVisible();
  const transcript = screen.getByTestId("transcript");
  await expect(transcript.getByText("Reviews").first()).toBeVisible();
  await expect(transcript.getByText("test: a sample event").first()).toBeVisible();
  await expect(transcript.getByText("Fixture response.")).toBeVisible();
  await expect(screen.getByText("Latest trigger runs")).toBeVisible();
  await expect(screen.getByText("Fired", { exact: true })).toBeVisible();
  await expect(screen.getByText(/ · test$/u)).toBeVisible();
  const listed = async () => (await hui.api<{ runs: { status: string; test?: boolean; summary: string }[] }>("GET", `/__hui/bots/${bot.id}/triggers`)).runs;
  expect(await listed()).toEqual([expect.objectContaining({ status: "fired", test: true, summary: "test: a sample event" })]);

  // A test that can't reach the bot says why, and HUI claims nothing was sent.
  const refusal = await hui.intercept("POST", /\/__hui\/bots\/[^/]+\/triggers\/[^/]+\/test$/u);
  await screen.getByRole("button", "Test Reviews").tap();
  await refusal.reject(409, "@sampler is archived: restore it to wake it.");
  await expect(screen.getByText("@sampler is archived: restore it to wake it.")).toBeVisible();
  await expect(screen.getByText("Sent a test event to Sampler's chat.")).toBeHidden();
  expect(await listed()).toHaveLength(1);
});
