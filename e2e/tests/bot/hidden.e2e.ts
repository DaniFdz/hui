/** A row's ⋯ → Hide takes a bot out of the roster, Show hidden (N) lists it with a Hidden tag and Unhide puts it back, and with every bot hidden the roster says so (BOT-013). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("Hide takes a bot off the roster, Show hidden lists it with a Hidden tag, Unhide puts it back and its toggle goes, and every bot hidden says so", { tags: ["BOT-013"], platforms: ["web"] }, async ({ screen, hui }) => {
  await hui.api("POST", "/__hui/bots", { name: "Napper", soul: "# Who I am\nA terse fixture bot.\n" });
  await hui.open("/");
  await screen.getByRole("tab", "Bots").tap();
  const row = screen.getByLabel(/^Napper,/u);
  const menu = screen.getByRole("button", "Actions for Napper");
  await expect(row).toBeVisible();

  await hui.peek(row);
  await menu.tap();
  await screen.getByText("Hide", { exact: true, visible: true }).tap();
  await expect(screen.getByText("Napper is hidden. Show hidden lists it again.")).toBeVisible();
  await expect(row).toBeHidden();
  const toggle = screen.getByRole("button", "Show hidden (1)");
  await expect(toggle).toBeVisible();

  await toggle.tap();
  await expect(row).toBeVisible();
  await expect(row.getByText("Hidden")).toBeVisible();

  await hui.peek(row);
  await menu.tap();
  await screen.getByText("Unhide", { exact: true, visible: true }).tap();
  await expect(screen.getByText("Napper is back in the roster.")).toBeVisible();
  await expect.poll(async () => screen.getByText(/^Show hidden/u).count()).toBe(0);

  await hui.peek(row);
  await menu.tap();
  await screen.getByText("Hide", { exact: true, visible: true }).tap();
  // The seeded Chief of Staff is a bot too: hide it before the roster can say every bot is hidden.
  const chief = screen.getByLabel(/^Chief of Staff,/u);
  await hui.peek(chief);
  await screen.getByRole("button", "Actions for Chief of Staff").tap();
  await screen.getByText("Hide", { exact: true, visible: true }).tap();
  await expect(screen.getByText("Every bot is hidden.")).toBeVisible();
  await expect(screen.getByRole("button", "Show hidden (2)")).toBeVisible();

  // The roster is shared by the suite: unhide whatever this test hid, so the Chief of Staff is back for the next test.
  const hiddenBots = (await hui.api<{ bots: Array<{ id: string; hidden?: boolean }> }>("GET", "/__hui/bots")).bots.filter((bot) => bot.hidden);
  for (const bot of hiddenBots) await hui.api("PATCH", `/__hui/bots/${bot.id}`, { hidden: false });
});