/**
 * An empty roster explains what a bot is and offers New bot and Import bot…, a pending first read says "Loading bots…",
 * a failed read shows the error with Retry that loads the roster again, and with only archived bots it says "No active
 * bots" (BOT-003).
 *
 * It empties a gateway of its own (`hui.world("plain")`): a fresh gateway seeds its Chief of Staff once and never again,
 * so deleting that bot from the gateway the suite shares would leave every later test without the staff pack it assumes.
 */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";
import { roster } from "./bot-panel.ts";
import type { World } from "../../fixtures/world.ts";

type Bot = { id: string; archived?: boolean };

/** Every bot a gateway keeps, archived ones included. */
const bots = async (world: World): Promise<Bot[]> => [
  ...(await world.api<{ bots: Bot[] }>("GET", "/__hui/bots")).bots,
  ...(await world.api<{ bots: Bot[] }>("GET", "/__hui/bots?archived=1")).bots,
];

test("an empty roster explains what a bot is, a pending read says Loading bots…, a failed read shows Retry, and archived bots leave No active bots", { tags: ["BOT-003"], platforms: ["web"] }, async ({ screen, hui }) => {
  // This gateway is the test's: deleting the bot a fresh gateway seeds leaves a gateway with none, and no other test
  // reads it. The launcher answers before the gateway's backend has seeded that bot, so the roster is read until it
  // holds one; a delete that lands while the pack is still being written into the bot's folder is then refused with the
  // folder it could not remove, and the drain reads the roster and tries again until it stays empty.
  const world = await hui.world("plain");
  await expect.poll(async () => (await bots(world)).length, { timeout: 60_000 }).not.toBe(0);
  const drain = async () => {
    for (const bot of await bots(world)) {
      await world.api("DELETE", `/__hui/bots/${bot.id}?permanent=1`).catch((error: unknown) => {
        if (!String(error).includes("ENOTEMPTY")) throw error;
      });
    }
    return (await bots(world)).length;
  };
  await expect.poll(drain, { timeout: 60_000 }).toBe(0);

  await hui.open(`${world.url}/`);
  await roster(screen, hui);
  const empty = screen.getByLabel("Bots").last();
  await expect(screen.getByText("No bots yet")).toBeVisible();
  await expect(screen.getByText(/^A bot is a named agent with one permanent chat, its own model and a memory that summarizes older messages by itself\./u)).toBeVisible();
  await expect(empty.getByRole("button", "New bot")).toBeVisible();
  await expect(empty.getByRole("button", "Import bot…")).toBeVisible();

  // The first read is pending: the roster says so until the gateway answers with none. A gateway without the bot stream
  // makes the client read the list, whose read the test holds.
  const events = await hui.intercept("GET", /\/__hui\/bots\/events$/u);
  const first = await hui.intercept("GET", /\/__hui\/bots$/u);
  await hui.reload();
  await events.arrived();
  await events.reject(404, "No bot stream on this gateway.");
  await first.arrived();
  await roster(screen, hui);
  await expect(screen.getByText("Loading bots…")).toBeVisible();
  await first.deliver();
  await expect(screen.getByText("No bots yet")).toBeVisible();

  // A read that fails shows the gateway's error and Retry, which reads the roster again.
  const again = await hui.intercept("GET", /\/__hui\/bots\/events$/u);
  const failed = await hui.intercept("GET", /\/__hui\/bots$/u);
  await hui.reload();
  await again.arrived();
  await again.reject(404, "No bot stream on this gateway.");
  await failed.arrived();
  await roster(screen, hui);
  await failed.reject(500, "The roster could not be read.");
  await expect(screen.getByRole("alert").getByText("The roster could not be read.")).toBeVisible();
  await expect(screen.getByText("No bots yet")).toBeHidden();
  await screen.getByRole("button", "Retry").tap();
  await expect(screen.getByText("No bots yet")).toBeVisible();
  await expect(screen.getByRole("alert")).toHaveCount(0);

  // With only an archived bot the roster names the situation, and Show archived lists it.
  const shelved = (await world.api<{ bot: { id: string } }>("POST", "/__hui/bots", { name: "Shelved", soul: "# Who I am\nA terse fixture bot.\n" })).bot;
  await world.api("DELETE", `/__hui/bots/${shelved.id}`);
  await hui.reload();
  await roster(screen, hui);
  await expect(screen.getByText("No active bots")).toBeVisible();
  await expect(screen.getByText("One archived bot keeps its chat and memory; Show archived lists it to restore or delete.")).toBeVisible();
  await expect(screen.getByRole("button", "Show archived (1)")).toBeVisible();
  await expect(screen.getByRole("button", "Show archived (1)")).toBeEnabled();
  await expect(empty.getByRole("button", "New bot")).toBeVisible();
  await expect(empty.getByRole("button", "Import bot…")).toBeVisible();
});
