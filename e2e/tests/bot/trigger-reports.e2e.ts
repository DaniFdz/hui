/** A listener's report wakes a bot once: the chat shows the trigger's message with its summary and the pull requests it
 * links to, the bot answers, and a report it already sent or one its filter leaves out wakes nobody (BOT-049); and
 * events that arrive within a trigger's cooldown wait on its card and go out as one delivery read as Coalesced, while
 * past the bot's hourly cap they wait instead of being dropped (BOT-051). */
import { expect } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";
import { panelOverview } from "./bot-panel.ts";

/** The card's pending line: the clock time the wait goes out at, or that time and its date when the cooldown ends past
 * local midnight, which `whenLabel` names rather than leaving tomorrow's "12:05 AM" reading as today's. */
const waitingAt = /^1 event waits, sent together at (?:[A-Z][a-z]{2} \d{1,2}, )?\d{1,2}:\d{2}(?:\s?[AP]M)?$/u;

const makeBot = async (hui: Hui, name: string) =>
  (await hui.api<{ bot: { id: string } }>("POST", "/__hui/bots", { name, soul: "# Who I am\nA terse fixture bot.\n" })).bot;

const triggerList = (hui: Hui, botId: string) =>
  hui.api<{ triggers: { id: string; name: string; pending?: { events: number; until: string } }[]; runs: { status: string; events: number; summary: string }[] }>("GET", `/__hui/bots/${botId}/triggers`);

test("a listener's report wakes the bot once, as the trigger's message with its linked pull requests, and the same report or one its filter leaves out wakes nobody", { tags: ["BOT-049"], platforms: ["web"] }, async ({ screen, hui }) => {
  const bot = await makeBot(hui, "Relay");
  const { hook } = await hui.api<{ hook: { path: string } }>("POST", `/__hui/bots/${bot.id}/triggers`, {
    name: "Reviews", prompt: "Look at it.", cooldownSeconds: 0,
    filter: { match: { field: "fields.channel", op: "equals", value: "C0123" } },
  });
  const transcript = screen.getByTestId("transcript");
  await hui.open(`/bots/${bot.id}`);
  const panel = await panelOverview(screen, "Relay");
  await panel.getByRole("button", "Add trigger").tap();
  await expect(screen.getByRole("list", "Triggers").getByText('fields.channel equals "C0123"')).toBeVisible();

  const report = (id: string, channel: string) => ({ events: [{ id, summary: `review ${id}`, details: `RAW ${id}`, at: new Date().toISOString(), links: ["https://github.com/acme/web/pull/42"], fields: { channel } }] });
  const fired = await hui.api<{ status: string }>("POST", hook.path, report("one", "C0123"));
  expect(fired.status).toBe("fired");

  // The chat shows the trigger's message: its name, its summary, what to do and the pull request it links to, then an answer.
  await expect(transcript.getByText("Reviews", { exact: true })).toBeVisible();
  await expect(transcript.getByText("review one", { exact: true }).first()).toBeVisible();
  await expect(transcript.getByText(/What a listener the operator runs reported, with the pull requests it links to\./u)).toBeVisible();
  await expect(transcript.getByText(/acme\/web\/pull\/42/u).first()).toBeVisible();
  await expect(transcript.getByText("Fixture response.")).toHaveCount(1);
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();

  // Its card and its run say it fired, naming the event.
  await expect(screen.getByText(/^Last fired just now · cooldown none · steers with summaries and links$/u)).toBeVisible();
  await expect(screen.getByText("Latest trigger runs")).toBeVisible();
  await expect(screen.getByText("Fired", { exact: true })).toBeVisible();
  await expect.poll(async () => (await triggerList(hui, bot.id)).runs).toEqual([expect.objectContaining({ status: "fired", events: 1, summary: "review one" })]);

  // The same report again, and an event its filter leaves out, wake nobody.
  expect((await hui.api<{ status: string }>("POST", hook.path, report("one", "C0123"))).status).toBe("ignored");
  expect((await hui.api<{ status: string }>("POST", hook.path, report("two", "C9999"))).status).toBe("ignored");
  await expect(transcript.getByText("review two", { exact: true })).toBeHidden();
  await expect(transcript.getByText("Reviews", { exact: true })).toHaveCount(1);
  await expect(transcript.getByText("Fixture response.")).toHaveCount(1);
  expect((await triggerList(hui, bot.id)).runs).toHaveLength(1);
});

test("events within a trigger's cooldown wait on its card and reach the chat as one delivery read as Coalesced, and past the hourly cap they wait instead of being dropped", { tags: ["BOT-051"], platforms: ["web"] }, async ({ screen, hui }) => {
  const bot = await makeBot(hui, "Digests");
  const { hook } = await hui.api<{ hook: { path: string } }>("POST", `/__hui/bots/${bot.id}/triggers`, { name: "Digests", prompt: "Summarize it.", cooldownSeconds: 60, delivery: "followUp" });
  const transcript = screen.getByTestId("transcript");
  await hui.open(`/bots/${bot.id}`);
  await panelOverview(screen, "Digests");
  await screen.getByRole("button", "Add trigger").tap();
  const report = (id: string) => ({ events: [{ id: `batch-${id}`, summary: `event ${id}`, details: `RAW ${id}`, at: new Date().toISOString() }] });

  // The first event goes at once; the second waits for the cooldown, and the card says how long.
  expect((await hui.api<{ status: string }>("POST", hook.path, report("a"))).status).toBe("fired");
  await expect(transcript.getByText("event a", { exact: true }).first()).toBeVisible();
  await expect(screen.getByText(/^Last fired just now · cooldown 1 min$/u)).toBeVisible();
  expect((await hui.api<{ status: string }>("POST", hook.path, report("b"))).status).toBe("held");
  await expect(screen.getByText(waitingAt)).toBeVisible();
  await expect(transcript.getByText("event b", { exact: true })).toBeHidden();
  expect(await triggerList(hui, bot.id).then((list) => list.triggers[0]!.pending?.events)).toBe(1);

  // Shortening the cooldown lets what waited go, with the next report: one delivery listing both, read as Coalesced.
  const trigger = (await triggerList(hui, bot.id)).triggers[0]!;
  await hui.api("PATCH", `/__hui/bots/${bot.id}/triggers/${trigger.id}`, { cooldownSeconds: 1 });
  expect((await hui.api<{ status: string }>("POST", hook.path, report("c"))).status).toBe("held");
  await expect.poll(async () => (await triggerList(hui, bot.id)).runs.map((run) => run.status)).toEqual(["coalesced", "fired"]);
  await expect(transcript.getByText("2 events within 1 s", { exact: true })).toBeVisible();
  await expect(transcript.getByText(/event b/u)).toBeVisible();
  await expect(transcript.getByText(/event c/u)).toBeVisible();
  await expect(transcript.getByText("Fixture response.")).toHaveCount(2);
  const coalesced = (await triggerList(hui, bot.id)).runs[0]!;
  expect(coalesced.events).toBe(2);
  await expect(screen.getByText(/^Coalesced$/u)).toBeVisible();

  // Twelve deliveries fill the bot's hour; the next waits for a slot instead of being dropped.
  const burst = await makeBot(hui, "Burst");
  const second = await hui.api<{ hook: { path: string } }>("POST", `/__hui/bots/${burst.id}/triggers`, { name: "Burst", prompt: "Take it.", cooldownSeconds: 0, delivery: "followUp" });
  for (let index = 0; index < 12; index += 1) {
    expect((await hui.api<{ status: string }>("POST", second.hook.path, report(`cap-${index}`))).status).toBe("fired");
  }
  await expect.poll(async () => (await triggerList(hui, burst.id)).runs).toHaveLength(12);
  expect((await hui.api<{ status: string }>("POST", second.hook.path, report("cap-12"))).status).toBe("held");
  const held = await triggerList(hui, burst.id);
  expect(held.triggers[0]!.pending?.events).toBe(1);
  expect(held.runs).toHaveLength(12);

  // The card of the bot whose chat is open says it in the UI's words: twelve of twelve, and one event waiting.
  await hui.open(`/bots/${burst.id}`);
  await panelOverview(screen, "Burst");
  await screen.getByRole("button", "Add trigger").tap();
  await expect(screen.getByText("12 of 12 trigger deliveries in the last hour.")).toBeVisible();
  await expect(screen.getByText(waitingAt)).toBeVisible();
  await expect(transcript.getByText("event cap-11", { exact: true }).first()).toBeVisible();
  await expect(transcript.getByText("event cap-12", { exact: true })).toBeHidden();
});
