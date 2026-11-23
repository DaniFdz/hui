/** A trigger that steers says so on its card, and an event it takes while the bot works joins that turn with the
 * summary and links only, without stopping it; while the bot is idle the event starts a turn, and a trigger without the
 * option keeps full-context follow-ups (BOT-055). */
import { expect } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";
import { hideBotPanel, panelOverview } from "./bot-panel.ts";

const makeBot = async (hui: Hui, name: string) =>
  (await hui.api<{ bot: { id: string; name: string } }>("POST", "/__hui/bots", { name, soul: "# Who I am\nA terse fixture bot.\n" })).bot;

const event = (id: string, details: string) => ({ id, summary: `review ${id}`, details, at: new Date().toISOString() });

test("a trigger that steers joins the turn already running with its summary and links only without stopping it, an event while idle starts a turn, and a trigger without the option waits as a full-context follow-up", { tags: ["BOT-055"], platforms: ["web"] }, async ({ screen, hui }) => {
  const bot = await makeBot(hui, "Relay");
  await hui.open(`/bots/${bot.id}`);
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();
  const panel = await panelOverview(screen, "Relay");
  const transcript = screen.getByTestId("transcript");

  // The add form steers unless the operator clears it, and the new card says so.
  await screen.getByRole("button", "Add trigger").tap();
  await expect(panel.getByRole("region", "Triggers")).toBeVisible();
  await expect(screen.getByRole("checkbox", "Steer the current turn with summaries and PR links only")).toBeChecked();
  await screen.getByPlaceholder("Reviews").fill("Reviews");
  await screen.getByLabel("Cooldown").selectOption({ label: "None" });
  await screen.getByPlaceholder("What should Relay do when it fires?").fill("Look at it.");
  await screen.getByRole("button", "Add trigger").tap();
  await expect(screen.getByText("Reviews: its URL")).toBeVisible();
  const shown = (await screen.getByLabel("URL of Reviews").textContent()) ?? "";
  const steering = new URL(shown).pathname;
  await screen.getByRole("button", "Done").tap();
  const cards = screen.getByRole("list", "Triggers");
  await expect(cards.getByText(/^Never fired · cooldown none · steers with summaries and links$/u)).toBeVisible();

  // The same add form without the option: its card says nothing about steering.
  const { hook: waiting } = await hui.api<{ hook: { path: string } }>("POST", `/__hui/bots/${bot.id}/triggers`, { name: "Watcher", prompt: "Read it all.", cooldownSeconds: 0, delivery: "followUp" });
  const watcherCard = cards.getByText("Watcher", { exact: true });
  await expect(watcherCard).toBeVisible();
  await expect(screen.getByText(/^Never fired · cooldown none$/u)).toBeVisible();

  // An event while the bot's turn is held at the model joins that turn: its summary arrives, its details never do, and
  // the turn goes on to its one reply.
  await hideBotPanel(screen);
  await screen.getByLabel("Message").fill("E2E_REPLAY");
  await screen.getByRole("button", "Send message").tap();
  await hui.provider.held();
  await hui.api("POST", steering, { events: [event("s1", "RAW_STEERED_DETAILS")] });
  await hui.provider.release();
  await expect(transcript.getByText(/review s1/u).first()).toBeVisible();
  await expect(transcript.getByText("Fixture response.")).toHaveCount(1);
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();
  await expect(transcript.getByText(/RAW_STEERED_DETAILS/u)).toBeHidden();

  // While the bot is idle the same trigger starts a turn of its own.
  await hui.api("POST", steering, { events: [event("s2", "RAW_IDLE_DETAILS")] });
  await expect(transcript.getByText(/review s2/u).first()).toBeVisible();
  await expect(transcript.getByText("Fixture response.")).toHaveCount(2);
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();

  // A trigger that does not steer hands the event over as a full-context follow-up once the turn it met has ended.
  await screen.getByLabel("Message").fill("E2E_REPLAY");
  await screen.getByRole("button", "Send message").tap();
  await hui.provider.held();
  await hui.api("POST", waiting.path, { events: [event("w1", "RAW_FOLLOWUP_DETAILS")] });
  await hui.provider.release();
  await expect(transcript.getByText(/RAW_FOLLOWUP_DETAILS/u)).toBeVisible();
  await expect(transcript.getByText("Fixture response.")).toHaveCount(3);
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();
  await expect(transcript.getByText(/RAW_STEERED_DETAILS/u)).toBeHidden();
});
