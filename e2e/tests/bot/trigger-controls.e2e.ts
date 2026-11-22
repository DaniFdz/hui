/** A trigger's Test puts a sample event in the bot's chat and says so, or says why it could not reach it (BOT-052); and
 * its switch turns it off so reports wake nobody and on again, while Delete removes it from its page and the overview
 * (BOT-054). */
import { expect } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";
import { panelOverview } from "./bot-panel.ts";

const makeBot = async (hui: Hui, name: string) =>
  (await hui.api<{ bot: { id: string } }>("POST", "/__hui/bots", { name, soul: "# Who I am\nA terse fixture bot.\n" })).bot;

const event = (id: string) => ({ id, summary: `review ${id}`, details: `RAW ${id}`, at: new Date().toISOString() });

/** The report's outcome, or the refusal's message. */
const report = (hui: Hui, path: string, id: string) =>
  hui.api<{ status: string }>("POST", path, { events: [event(id)] }).then((body) => body.status, (error: Error) => error.message);

test("Test puts a sample event in the bot's chat and says so, and says why when it cannot reach it", { tags: ["BOT-052"], platforms: ["web"] }, async ({ screen, hui }) => {
  const bot = await makeBot(hui, "Tester");
  await hui.api("POST", `/__hui/bots/${bot.id}/triggers`, { name: "Reviews", prompt: "Look at it.", cooldownSeconds: 0 });
  const transcript = screen.getByTestId("transcript");
  await hui.open(`/bots/${bot.id}`);
  const panel = await panelOverview(screen, "Tester");
  await panel.getByRole("button", "Add trigger").tap();
  await expect(screen.getByRole("list", "Triggers").getByText("Never fired", { exact: false })).toBeVisible();

  await screen.getByRole("button", "Test Reviews").tap();
  await expect(screen.getByText("Sent a test event to Tester's chat.")).toBeVisible();
  await expect(transcript.getByText("Reviews", { exact: true })).toBeVisible();
  await expect(transcript.getByText("test: a sample event", { exact: true })).toBeVisible();
  await expect(transcript.getByText(/This one is a sample the operator sent to test the trigger, not a real event\./u)).toBeVisible();
  await expect(transcript.getByText("Fixture response.")).toHaveCount(1);
  // The run is recorded as the test it was, and the test moves neither the cooldown nor the hour's deliveries.
  await expect.poll(async () => (await hui.api<{ runs: { status: string; test?: boolean }[]; deliveries: { lastHour: number } }>("GET", `/__hui/bots/${bot.id}/triggers`)).runs)
    .toEqual([expect.objectContaining({ status: "fired", test: true })]);
  expect((await hui.api<{ deliveries: { lastHour: number } }>("GET", `/__hui/bots/${bot.id}/triggers`)).deliveries.lastHour).toBe(0);

  // A test the bot's chat cannot take says why, in the bot's name.
  const failing = await hui.intercept("POST", /\/__hui\/bots\/[^/]+\/triggers\/[^/]+\/test$/u);
  await screen.getByRole("button", "Test Reviews").tap();
  await failing.answer(JSON.stringify({ run: { id: "r", triggerId: "t", triggerName: "Reviews", at: new Date().toISOString(), status: "failed", events: 1, summary: "a sample event", reason: "Tester's worker is offline" } }));
  await expect(screen.getByText("The test did not reach Tester: Tester's worker is offline.")).toBeVisible();
  await expect(transcript.getByText("Fixture response.")).toHaveCount(1);
});

test("a trigger's switch turns it off so reports wake nobody and on again, and Delete removes it from its page and the overview", { tags: ["BOT-054"], platforms: ["web"] }, async ({ screen, hui }) => {
  const bot = await makeBot(hui, "Relay");
  const { hook } = await hui.api<{ hook: { path: string } }>("POST", `/__hui/bots/${bot.id}/triggers`, { name: "Reviews", prompt: "Look at it.", cooldownSeconds: 0 });
  await hui.api("POST", `/__hui/bots/${bot.id}/triggers`, { name: "Alerts", prompt: "Read it.", cooldownSeconds: 0 });
  const enabled = async (name: string) =>
    (await hui.api<{ triggers: { name: string; enabled: boolean }[] }>("GET", `/__hui/bots/${bot.id}/triggers`)).triggers.find((trigger) => trigger.name === name)?.enabled;
  const transcript = screen.getByTestId("transcript");
  await hui.open(`/bots/${bot.id}`);
  const panel = await panelOverview(screen, "Relay");
  await panel.getByRole("button", "Add trigger").tap();
  await expect(screen.getByRole("switch", "Enable Reviews")).toBeChecked();

  // Off on its page: the listener's report is refused and nothing reaches the chat.
  await hui.flip(screen.getByRole("switch", "Enable Reviews"));
  await expect(screen.getByRole("switch", "Enable Reviews")).toBeChecked({ checked: false });
  await expect.poll(() => enabled("Reviews")).toBe(false);
  expect(await report(hui, hook.path, "off")).toContain("409");
  expect(await report(hui, hook.path, "off")).toContain("This trigger is off: turn it on in the bot's panel.");
  await expect(transcript.getByText("Reviews", { exact: true })).toBeHidden();
  expect(await report(hui, hook.path, "off")).not.toContain("fired");

  // On again: the same URL wakes the bot, and the run reads Fired.
  await hui.flip(screen.getByRole("switch", "Enable Reviews"));
  await expect(screen.getByRole("switch", "Enable Reviews")).toBeChecked();
  await expect.poll(() => enabled("Reviews")).toBe(true);
  await expect.poll(() => report(hui, hook.path, "on")).toBe("fired");
  await expect(transcript.getByText("Reviews", { exact: true })).toBeVisible();
  await expect(transcript.getByText("review on", { exact: true }).first()).toBeVisible();
  await expect(screen.getByText("Fired", { exact: true })).toBeVisible();

  // The overview's row has the same switch.
  await screen.getByRole("button", "Back to Relay").tap();
  await expect(panel.getByText("Alerts", { exact: true })).toBeVisible();
  await hui.flip(panel.getByRole("switch", "Enable Alerts"));
  await expect(panel.getByRole("switch", "Enable Alerts")).toBeChecked({ checked: false });
  await expect.poll(() => enabled("Alerts")).toBe(false);

  // Delete takes Reviews off its page and off the overview, with its run.
  await panel.getByRole("button", "Add trigger").tap();
  await screen.getByRole("button", "Delete Reviews").tap();
  await expect(screen.getByRole("list", "Triggers").getByText("Reviews", { exact: true })).toBeHidden();
  await expect(panel.getByText("Fired", { exact: true })).toBeHidden();
  await expect(screen.getByRole("list", "Triggers").getByText("Alerts", { exact: true })).toBeVisible();
  await screen.getByRole("button", "Back to Relay").tap();
  await expect(panel.getByText("Reviews", { exact: true })).toBeHidden();
  await expect(panel.getByText("Alerts", { exact: true })).toBeVisible();
  expect((await hui.api<{ triggers: { name: string }[] }>("GET", `/__hui/bots/${bot.id}/triggers`)).triggers.map((trigger) => trigger.name)).toEqual(["Alerts"]);
  expect(await report(hui, hook.path, "gone")).toContain("404");
});
