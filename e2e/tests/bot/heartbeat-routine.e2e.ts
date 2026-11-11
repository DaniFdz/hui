/** Every Chief of Staff, seeded or group, gets one Heartbeat routine (BOT-076). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

type Bot = { id: string; name: string; group?: string; routines: number };

test("the seeded chief and a group chief each get one Heartbeat routine", { tags: ["BOT-076"], platforms: ["web"] }, async ({ hui }) => {
  const list = async () => (await hui.api<{ bots: Bot[] }>("GET", "/__hui/bots")).bots;
  const seeded = (await list()).find((bot) => bot.name === "Chief of Staff")!;
  expect(seeded.routines).toBeGreaterThan(0);

  const group = "Heartbeat Group E2E";
  const chief = (await hui.api<{ bot: Bot }>("POST", "/__hui/staff/chiefs", { group, cwd: hui.workspace })).bot;
  await expect.poll(async () => (await list()).find((bot) => bot.id === chief.id)?.routines, { timeout: 30_000 }).toBeGreaterThan(0);
  // Asking again reuses the chief and does not add a second routine.
  const again = (await hui.api<{ bot: Bot }>("POST", "/__hui/staff/chiefs", { group, cwd: hui.workspace })).bot;
  expect(again.id).toBe(chief.id);
  expect((await list()).find((bot) => bot.id === chief.id)?.routines).toBe(1);
});
