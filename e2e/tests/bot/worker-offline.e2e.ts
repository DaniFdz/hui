/** When its worker disconnects a bot's chat reads Disconnected from <worker> with Reconnect, its roster row goes
 * unreachable while the roster still answers, the + says the worker is disconnected and refuses a new bot there until it
 * is connected again, which brings everything back (BOT-066). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";
import { roster } from "./bot-panel.ts";


test("a worker bot's chat reads Disconnected from its worker with Reconnect, its roster row goes unreachable, the + refuses a new bot there until the worker connects again", { tags: ["BOT-066"], platforms: ["web"] }, async ({ screen, hui }) => {
  const name = "Far box";
  const worker = await hui.addWorker(name);
  const bot = (await hui.api<{ bot: { id: string; name: string } }>("POST", "/__hui/bots", { name: "Sentinel", worker: worker.id, soul: "# Who I am\nA terse fixture bot.\n" })).bot;
  const header = screen.getByTestId("chat-header");

  // The bot runs on the worker, so its chat comes up there.
  await hui.open(`/bots/${bot.id}`);
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();
  await expect(header.getByText(name)).toBeVisible();

  // The worker goes away from Settings → Workers, as the operator does it.
  await hui.open("/settings/workers");
  const page = screen.getByTestId("settings-page");
  await page.getByRole("button", "Disconnect").tap();
  await expect(page.getByText("Disconnected", { exact: true })).toBeVisible();

  // The roster still answers, and its row says the bot is unreachable.
  await hui.open("/");
  await roster(screen, hui);
  await expect(screen.getByLabel(new RegExp(`^Sentinel, on ${name}, unreachable`, "u"))).toBeVisible();

  // + names the worker as disconnected, and creating there is refused with what to do about it.
  await screen.getByRole("button", "New bot").tap();
  await expect(screen.getByText(`New bot on ${name} · disconnected`)).toBeVisible();
  await screen.getByText(`New bot on ${name} · disconnected`).tap();
  await expect(screen.getByText(`HUI is not connected to ${name}. Connect it in Settings → Workers, then create the bot again.`)).toBeVisible();

  // Its chat says which machine it is disconnected from, and offers to connect it again.
  await hui.open(`/bots/${bot.id}`);
  await expect(screen.getByLabel(`Session status: Disconnected from ${name}`)).toBeVisible();
  await expect(screen.getByRole("button", "Reconnect")).toBeVisible();

  // Connecting the worker again brings the chat back.
  await hui.open("/settings/workers");
  await screen.getByTestId("settings-page").getByRole("button", "Connect").tap();
  await expect(screen.getByTestId("settings-page").getByText("Connected", { exact: true })).toBeVisible();
  await hui.open(`/bots/${bot.id}`);
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();
  await expect(header.getByText(name)).toBeVisible();
  await roster(screen, hui);
  await expect(screen.getByLabel(new RegExp(`^Sentinel, on ${name}, `, "u"))).toBeVisible();
  await expect(screen.getByLabel(new RegExp(`^Sentinel, on ${name}, unreachable`, "u"))).toBeHidden();
});
