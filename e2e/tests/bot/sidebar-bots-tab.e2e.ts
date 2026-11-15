/** Agents and Bots swap the sidebar list while keeping its six destinations, Search bots and its +; the choice
 * survives reload and a bot's page, in the mobile drawer too (BOT-001). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("Agents and Bots keep the navigation and swap only the list, with the choice preserved after reload and opening a bot, in the drawer too", { tags: ["BOT-001"], platforms: ["web"] }, async ({ screen, hui }) => {
  await hui.api("POST", "/__hui/bots", { name: "Scout", soul: "# Who I am\nA terse fixture bot.\n" });
  await hui.open("/");
  // A phone keeps the sidebar in the navigation drawer; on the wide layout this is nothing.
  await hui.sessionList();
  const agents = screen.getByRole("tab", "Agents");
  const bots = screen.getByRole("tab", "Bots");
  const navigation = screen.getByLabel("Primary navigation");
  const checkNavigation = async () => {
    await expect(navigation).toBeVisible();
    await expect.poll(() => hui.textOf(navigation)).toBe("Dashboard Contributions Kanban Sessions Usage Settings");
  };
  await expect(agents).toBeVisible();
  await expect(bots).toBeVisible();
  await expect(agents).toHaveAttribute("aria-selected", "true");
  await checkNavigation();

  await bots.tap();
  await expect(bots).toHaveAttribute("aria-selected", "true");
  await expect(agents).toHaveAttribute("aria-selected", "false");
  await checkNavigation();
  await expect(screen.getByPlaceholder("Search bots")).toBeVisible();
  await expect(screen.getByPlaceholder("Search sessions")).toHaveCount(0);
  await expect(screen.getByRole("button", "New bot")).toBeVisible();
  await expect(screen.getByLabel(/^Scout,/u)).toBeVisible();

  await hui.reload();
  await hui.sessionList();
  await expect(screen.getByRole("tab", "Bots")).toHaveAttribute("aria-selected", "true");
  await expect(screen.getByPlaceholder("Search bots")).toBeVisible();
  await checkNavigation();

  await screen.getByLabel(/^Scout,/u).tap();
  await expect.poll(() => hui.url()).toMatch(/\/bots\//u);
  await expect.poll(() => hui.textOf(screen.getByTestId("chat-header"))).toContain("Scout");
  await expect(screen.getByRole("button", "Close navigation").first()).toBeHidden();
  await hui.sessionList();
  await expect(screen.getByRole("tab", "Bots")).toHaveAttribute("aria-selected", "true");
  await checkNavigation();

  // A phone keeps the same tabs in the navigation drawer.
  await hui.phoneScreen();
  await hui.sessionList();
  await expect(screen.getByRole("tab", "Bots")).toHaveAttribute("aria-selected", "true");
  await expect(screen.getByPlaceholder("Search bots")).toBeVisible();
  await checkNavigation();

  await screen.getByRole("tab", "Agents").tap();
  await expect(screen.getByRole("tab", "Agents")).toHaveAttribute("aria-selected", "true");
  await checkNavigation();
  await expect(screen.getByPlaceholder("Search sessions")).toBeVisible();
  await expect(screen.getByLabel("Sessions")).toBeVisible();
  await expect(screen.getByLabel(/^Scout,/u)).toBeHidden();
});
