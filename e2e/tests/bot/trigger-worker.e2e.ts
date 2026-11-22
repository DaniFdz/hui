/** A bot on a worker takes its trigger's URL on that machine: the panel shows the worker's own loopback address, Copy
 * takes it as it came, a listener on that machine POSTs a report straight to it, and the report reaches the bot's chat
 * with its run; the create route answers the same address as `hook.worker` (BOT-078). */
import { expect } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";
import { panelOverview } from "./bot-panel.ts";

type Created = { hook: { path: string; worker?: { id: string; name: string; url?: string; error?: string } } };

const makeBotOn = async (hui: Hui, workerId: string, name: string) =>
  (await hui.api<{ bot: { id: string; name: string } }>("POST", "/__hui/bots", { name, worker: workerId, soul: "# Who I am\nA terse fixture bot.\n" })).bot;

/** A listener on that machine reports with plain HTTP: no `x-hui`, no gateway route, the address as it was shown. */
const report = async (url: string, id: string) => {
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ events: [{ id, summary: `review ${id}`, details: `RAW ${id}`, at: new Date().toISOString() }] }) });
  return { status: response.status, body: (await response.json()) as { status?: string } };
};

const HOOK_URL = /^http:\/\/127\.0\.0\.1:\d{2,5}\/__hui\/hooks\/[A-Za-z0-9_-]{43}$/u;

test("a bot on a worker shows its trigger's URL on that machine, Copy takes that address, a report posted there wakes it, and the create route answers it as hook.worker", { tags: ["BOT-078"], platforms: ["web"] }, async ({ screen, hui }) => {
  const workerName = "Far box";
  const worker = await hui.addWorker(workerName);
  const bot = await makeBotOn(hui, worker.id, "Remote");
  await hui.open(`/bots/${bot.id}`);
  await panelOverview(screen, "Remote");

  // The panel's add form, as the operator fills it, for a bot whose chat runs on the worker.
  await screen.getByRole("button", "Add trigger").tap();
  await expect(screen.getByRole("region", "Triggers")).toBeVisible();
  await screen.getByPlaceholder("Reviews").fill("Reviews");
  await screen.getByPlaceholder("What should Remote do when it fires?").fill("Look at it.");
  await screen.getByRole("button", "Add trigger").tap();

  // The URL comes once, and it is the worker's own loopback address, not this page's gateway.
  await expect(screen.getByText("Reviews: its URL")).toBeVisible();
  await expect(screen.getByText(new RegExp(`Your listener runs on ${workerName}: it reports to this address there\\.`, "u"))).toBeVisible();
  await expect(screen.getByText(/After every check it POSTs \{ "events": \[\.\.\.\] \} to it there, the list empty when nothing happened\./u)).toBeVisible();
  const shown = (await screen.getByLabel("URL of Reviews").textContent()) ?? "";
  expect(shown).toMatch(HOOK_URL);
  expect(new URL(shown).origin).not.toBe(new URL(await hui.url()).origin);
  await hui.clipboard();
  await screen.getByRole("button", "Copy").tap();
  await expect(screen.getByRole("button", "Copied")).toBeVisible();
  expect(await hui.copied()).toBe(shown);
  await screen.getByRole("button", "Done").tap();
  await expect(screen.getByText("Reviews: its URL")).toBeHidden();

  // A listener on that machine reports to that very address: the worker takes it and the gateway decides it.
  const fired = await report(shown, "remote-one");
  expect(fired.status).toBe(202);
  expect(fired.body.status).toBe("fired");

  // The bot's chat, there, shows the trigger's message, and its run is on the card.
  const transcript = screen.getByTestId("transcript");
  await expect(transcript.getByText("Reviews", { exact: true })).toBeVisible({ timeout: 120_000 });
  await expect(transcript.getByText("review remote-one", { exact: true }).first()).toBeVisible();
  await expect(screen.getByText(/^Last fired just now · cooldown 5 min/u)).toBeVisible();
  await expect(screen.getByText("Latest trigger runs")).toBeVisible();
  await expect(screen.getByText("Fired", { exact: true })).toBeVisible();
  await expect.poll(async () => (await hui.api<{ runs: { status: string; summary: string }[] }>("GET", `/__hui/bots/${bot.id}/triggers`)).runs)
    .toEqual([expect.objectContaining({ status: "fired", summary: "review remote-one" })]);

  // The route answers the same address as data, for the operator's own tooling: the machine's name and its URL.
  const second = await hui.api<Created>("POST", `/__hui/bots/${bot.id}/triggers`, { name: "Tickets", prompt: "Triage it.", cooldownSeconds: 0 });
  expect(second.hook.worker?.name).toBe(workerName);
  expect(second.hook.worker?.url).toMatch(HOOK_URL);
  expect(new URL(second.hook.worker!.url!).host).toBe(new URL(shown).host);
  expect(second.hook.path).not.toBe(new URL(shown).pathname);
  expect(new URL(second.hook.worker!.url!).pathname).toBe(second.hook.path);
});
