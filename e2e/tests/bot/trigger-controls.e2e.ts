/** A trigger's switch turns it off so reports wake nobody and on again, and Delete removes it from its page and the
 * overview (BOT-054); New URL shows a fresh URL once and the old one is refused from then on (BOT-053). */
import { expect } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";
import { panelOverview } from "./bot-panel.ts";

type Created = { trigger: { id: string }; hook: { token: string; path: string } };

const makeBot = async (hui: Hui, name: string) =>
  (await hui.api<{ bot: { id: string } }>("POST", "/__hui/bots", { name, soul: "# Who I am\nA terse fixture bot.\n" })).bot;

const report = (path: string, summary: string) =>
  ({ path, body: { events: [{ id: summary, summary, details: `raw ${summary}`, at: new Date().toISOString() }] } });

/** The gateway's answer to a request it refuses: its message, or "" when it accepted it. */
async function refusal(hui: Hui, method: string, path: string, body?: unknown): Promise<string> {
  try {
    await hui.api(method, path, body);
    return "";
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

test("a trigger's switch keeps a report from waking the bot and lets it through again, and Delete takes it off its page and the overview", { tags: ["BOT-054"], platforms: ["web"] }, async ({ screen, hui }) => {
  const bot = await makeBot(hui, "Regulator");
  const created = await hui.api<Created>("POST", `/__hui/bots/${bot.id}/triggers`, { name: "Reviews", prompt: "Look at it.", cooldownSeconds: 0 });
  const runs = async () => (await hui.api<{ runs: { status: string }[] }>("GET", `/__hui/bots/${bot.id}/triggers`)).runs;
  await hui.open(`/bots/${bot.id}`);
  const panel = await panelOverview(screen, "Regulator");
  await screen.getByRole("button", "Add trigger").tap();
  await expect(panel.getByRole("region", "Triggers")).toBeVisible();
  const card = screen.getByRole("list", "Triggers");
  const toggle = () => card.getByRole("switch", "Enable Reviews");
  const transcript = screen.getByTestId("transcript");

  await hui.api("POST", created.hook.path, report("", "alpha event").body);
  await expect.poll(async () => (await runs()).map((run) => run.status)).toEqual(["fired"]);
  await expect(transcript.getByText("alpha event")).toBeVisible();
  await expect(toggle()).toBeChecked();

  await hui.flip(toggle());
  await expect(toggle()).toBeChecked({ checked: false });
  await expect.poll(async () => (await hui.api<{ triggers: { enabled: boolean }[] }>("GET", `/__hui/bots/${bot.id}/triggers`)).triggers.map((trigger) => trigger.enabled)).toEqual([false]);
  expect(await refusal(hui, "POST", created.hook.path, report("", "beta event").body)).toMatch(/409: .*This trigger is off/u);
  expect(await runs()).toHaveLength(1);
  await expect(transcript.getByText("beta event")).toHaveCount(0);

  await hui.flip(toggle());
  await expect(toggle()).toBeChecked();
  await hui.api("POST", created.hook.path, report("", "gamma event").body);
  await expect.poll(async () => (await runs()).map((run) => run.status)).toEqual(["fired", "fired"]);
  await expect(transcript.getByText("gamma event")).toBeVisible();

  // The overview's own switch turns it off too.
  await screen.getByRole("button", "Back to Regulator").tap();
  const overviewTriggers = screen.getByLabel("Triggers", { exact: true });
  await expect(overviewTriggers.getByRole("button", /^Reviews/u)).toBeVisible();
  await hui.flip(overviewTriggers.getByRole("switch", "Enable Reviews"));
  await expect.poll(async () => (await hui.api<{ triggers: { enabled: boolean }[] }>("GET", `/__hui/bots/${bot.id}/triggers`)).triggers.map((trigger) => trigger.enabled)).toEqual([false]);

  // Delete takes it off its page and the overview.
  await overviewTriggers.getByRole("button", /^Reviews/u).tap();
  await screen.getByRole("button", "Delete Reviews").tap();
  await expect(card).toHaveCount(0);
  await expect(screen.getByText(/^No triggers yet\./u)).toBeVisible();
  await screen.getByRole("button", "Back to Regulator").tap();
  await expect(screen.getByRole("button", /^Reviews/u)).toHaveCount(0);
  await expect.poll(async () => await runs()).toEqual([]);
});

test("New URL shows a fresh URL once and the old one is refused from then on", { tags: ["BOT-053"], platforms: ["web"] }, async ({ screen, hui }) => {
  const bot = await makeBot(hui, "Rotator");
  const created = await hui.api<Created>("POST", `/__hui/bots/${bot.id}/triggers`, { name: "Reviews", prompt: "Look at it." });
  await hui.open(`/bots/${bot.id}`);
  const panel = await panelOverview(screen, "Rotator");
  await screen.getByRole("button", "Add trigger").tap();
  await expect(panel.getByRole("region", "Triggers")).toBeVisible();

  await screen.getByRole("button", "New URL for Reviews").tap();
  await expect(screen.getByText("Reviews: its URL")).toBeVisible();
  const fresh = (await screen.getByLabel("URL of Reviews").textContent())!;
  expect(new URL(fresh).pathname).not.toBe(created.hook.path);
  await expect(screen.getByRole("button", "Copy")).toBeVisible();
  await screen.getByRole("button", "Done").tap();
  await expect(screen.getByText("Reviews: its URL")).toHaveCount(0);
  await expect(screen.getByText(new RegExp(`^URL …/hooks/${new URL(fresh).pathname.split("/").at(-1)!.slice(0, 4)}…`, "u"))).toBeVisible();

  expect(await refusal(hui, "POST", created.hook.path, { events: [] })).toMatch(/404/u);
  await hui.api("POST", new URL(fresh).pathname, { events: [] });
});
