/**
 * A bot whose chat runs on a worker reads its own tools and skills from that worker, and a switch there saves the list
 * on the worker; while the worker is offline the page says so with Retry, which loads it again once HUI is connected
 * (BOT-065).
 *
 * What the worker's list holds is the worker host's own: HUI's tools that act on the gateway's machine are left out
 * (`watcher`, `GATEWAY_ONLY_TOOLS`), while the terminal and the managed browser do reach a worker's bot — the PTY is
 * HUI's here and a host runs its own browser — so the catalogue's "without the terminal, the browser or watchers" is
 * not what the page shows today. This test proves the list, the switch and the offline state; it does not claim the
 * terminal and the browser are missing, because they are not.
 */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";
import { panelOverview, showBotPanel } from "./bot-panel.ts";

type Catalog = { tools: { name: string; label: string }[]; skills: { name: string }[]; disabledTools: string[] };

test("a worker bot's Tools & skills reads the worker's own list, a switch saves it there, and an offline worker says so with Retry that loads it once it is connected", { tags: ["BOT-065"], platforms: ["web"] }, async ({ screen, hui }) => {
  const worker = await hui.addWorker("Far box");
  const bot = (await hui.api<{ bot: { id: string; name: string; sessionId: string } }>("POST", "/__hui/bots",
    { name: "Sentinel", worker: worker.id, soul: "# Who I am\nA terse fixture bot.\n" })).bot;
  const catalog = async () => hui.api<Catalog>("GET", `/__hui/bots/${bot.id}/catalog`);
  const stored = async () => (await hui.api<{ bot: { disabledTools?: string[] } }>("GET", `/__hui/bots/${bot.id}`)).bot.disabledTools ?? [];
  await hui.open(`/bots/${bot.id}`);
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();
  const offered = await catalog();
  // The worker's list: its tools, and none of HUI's tools that act on the gateway's machine.
  expect(offered.tools.length).toBeGreaterThan(0);
  expect(offered.tools.map((tool) => tool.name)).not.toContain("watcher");

  // The page lists them, switchable, as the worker answered.
  const panel = await panelOverview(screen, "Sentinel");
  await showBotPanel(screen, "Sentinel");
  await screen.getByText("Tools & skills", { exact: true }).tap();
  await expect(screen.getByRole("heading", "Available tools")).toBeVisible();
  for (const tool of offered.tools) await expect(screen.getByRole("switch", `${tool.label} (${tool.name})`)).toBeChecked();
  for (const skill of offered.skills) await expect(screen.getByRole("switch", `Skill ${skill.name}`)).toBeChecked();

  // A switch saves the whole list where the bot runs: the record follows, and so does the worker's next answer.
  const off = offered.tools.find((tool) => tool.name === "bash") ?? offered.tools[0]!;
  await hui.flip(screen.getByRole("switch", `${off.label} (${off.name})`));
  await expect(screen.getByRole("switch", `${off.label} (${off.name})`)).toBeChecked({ checked: false });
  expect(await stored()).toEqual([off.name]);
  await expect.poll(async () => (await catalog()).disabledTools).toEqual([off.name]);
  await expect(panel.getByText(/^1 of \d+ tools is off\./u)).toBeVisible();

  // The worker goes away from Settings → Workers: its bot's page says which machine is missing, and offers Retry.
  await hui.open("/settings/workers");
  const page = screen.getByTestId("settings-page");
  await page.getByRole("button", "Disconnect").tap();
  await expect(page.getByText("Disconnected", { exact: true })).toBeVisible();
  await hui.open(`/bots/${bot.id}`);
  await hui.reload();
  await showBotPanel(screen, "Sentinel");
  await screen.getByText("Tools & skills", { exact: true }).tap();
  await expect(screen.getByRole("alert")).toHaveText(/^Far box, where this bot runs, is offline: HUI is not connected to it\. Connect it in Settings → Workers, then try again\./u);
  await expect(screen.getByRole("button", "Retry")).toBeVisible();
  await expect(screen.getByRole("heading", "Available tools")).toHaveCount(0);

  // Connected again, Retry on the same page loads the worker's list as the switch left it.
  await hui.api("POST", `/__hui/workers/${worker.id}/connect`);
  await expect.poll(async () => (await hui.api<{ workers: { id: string; state: string }[] }>("GET", "/__hui/workers")).workers
    .find((each) => each.id === worker.id)?.state, { timeout: 120_000 }).toBe("connected");
  await screen.getByRole("button", "Retry").tap();
  await expect(screen.getByRole("heading", "Available tools")).toBeVisible();
  await expect(screen.getByRole("switch", `${off.label} (${off.name})`)).toBeChecked({ checked: false });
  await expect(screen.getByRole("switch", `${offered.tools.filter((tool) => tool.name !== off.name)[0]!.label} (${offered.tools.filter((tool) => tool.name !== off.name)[0]!.name})`)).toBeChecked();
});
