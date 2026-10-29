/** Settings lists its pages in groups and opens one from the list, a link or a reload, searches them, and closes with Exit Settings (SET-001, SET-002). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

const EVERY_PAGE = "Appearance Notifications Connections Gateway Integrations Workers Agents & Tools Models Plugins Skills Tools Memory Automation Privacy & Security Privacy & Security System Worktrees Diagnostics";

test("Settings opens the page chosen from its grouped list, a direct link or the old /worktrees link, keeps it across a reload, and Exit Settings leaves", { tags: ["SET-001"], platforms: ["web"] }, async ({ screen, hui }) => {
  const pages = screen.getByLabel("Settings pages");
  const page = (name: string) => screen.getByTestId("settings-page-link").filter({ hasText: name });
  const title = screen.getByTestId("settings-page-title");

  await hui.open("/settings/appearance");
  await expect(pages).toHaveText(EVERY_PAGE, { ignoreCase: true });
  await expect(title).toHaveText("Appearance");
  await expect(page("Appearance")).toHaveAttribute("aria-current", "page");

  await page("Gateway").tap();
  await expect(title).toHaveText("Gateway");
  await expect(screen.getByText("Gateway access and live PI runtime state.")).toBeVisible();
  await expect(page("Gateway")).toHaveAttribute("aria-current", "page");
  await expect(page("Appearance")).toHaveAttribute("aria-current", "false");
  await hui.reload();
  await expect(title).toHaveText("Gateway");
  await expect(page("Gateway")).toHaveAttribute("aria-current", "page");
  expect(await hui.url()).toMatch(/\/settings\/connection$/u);

  await hui.open("/settings/diagnostics");
  await expect(title).toHaveText("Diagnostics");
  await expect(page("Diagnostics")).toHaveAttribute("aria-current", "page");
  await hui.open("/worktrees");
  await expect(title).toHaveText("Worktrees");
  await expect.poll(() => hui.url()).toMatch(/\/settings\/worktrees$/u);

  await screen.getByRole("button", "Exit Settings").tap();
  await expect(screen.getByRole("button", "Start session")).toBeVisible();
  await expect(title).toBeHidden();
});

test("on a phone Open settings navigation shows the page list as a drawer, and Exit Settings leaves from it", { tags: ["SET-001"], platforms: ["web"] }, async ({ screen, hui }) => {
  const open = screen.getByRole("button", "Open settings navigation");
  const title = screen.getByTestId("settings-page-title");

  await hui.phoneScreen();
  await hui.open("/settings/models");
  await expect(title).toHaveText("Models");
  await expect(screen.getByRole("button", "Exit Settings")).toBeHidden();
  await open.tap();
  await expect(screen.getByRole("button", { name: "Close settings navigation", expanded: true })).toBeVisible();
  await screen.getByTestId("settings-page-link").filter({ hasText: "Diagnostics" }).tap();
  await expect(title).toHaveText("Diagnostics");
  await expect(open).toBeVisible();
  await expect(screen.getByRole("button", "Exit Settings")).toBeHidden();

  await open.tap();
  await screen.getByRole("button", "Exit Settings").tap();
  await expect(screen.getByRole("button", "Start session")).toBeVisible();
  await expect(title).toBeHidden();
});

test("Search settings keeps the pages whose name or group matches, says when none does, and clears", { tags: ["SET-002"] }, async ({ screen, hui }) => {
  const pages = screen.getByLabel("Settings pages");
  const search = screen.getByLabel("Search settings");
  const clear = screen.getByRole("button", "Clear settings search");
  const shown = async () => (await hui.textOf(pages)).replace(/\s+/gu, " ").trim();
  const listed = async () => (await shown()).toLowerCase();

  await hui.open("/settings/appearance");
  await hui.settingsPages();
  await expect(clear).toBeHidden();
  await search.fill("diagnostics");
  await expect.poll(listed).toBe("system diagnostics");
  await search.fill("connections");
  await expect.poll(listed).toBe("connections gateway integrations workers");
  await search.fill("no such page");
  await expect.poll(shown).toBe("No settings match.");

  await clear.tap();
  await expect(search).toHaveValue("");
  await expect.poll(listed).toBe(EVERY_PAGE.toLowerCase());
  await expect(clear).toBeHidden();
});
