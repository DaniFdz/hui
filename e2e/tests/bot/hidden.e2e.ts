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
  await expect(screen.getByText("Every bot is hidden.")).toBeVisible();
  await expect(screen.getByRole("button", "Show hidden (1)")).toBeVisible();
});