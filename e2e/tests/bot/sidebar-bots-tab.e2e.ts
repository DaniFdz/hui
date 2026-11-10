/** The sidebar's top row always offers Agents and Bots, Bots shows only the roster with Search bots and its +, the
 * choice survives a reload and a bot's page keeps the Bots tab, in the mobile drawer too (BOT-001). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("Agents and Bots are always offered, Bots shows only the roster with Search bots and its +, and the choice survives a reload and a bot's page, in the drawer too", { tags: ["BOT-001"], platforms: ["web"] }, async ({ screen, hui }) => {
  await hui.api("POST", "/__hui/bots", { name: "Scout", soul: "# Who I am\nA terse fixture bot.\n" });
  await hui.open("/");
  const agents = screen.getByRole("tab", "Agents");
  const bots = screen.getByRole("tab", "Bots");
  const navigation = screen.getByLabel("Primary navigation");
  await expect(agents).toBeVisible();
  await expect(bots).toBeVisible();
  await expect(agents).toHaveAttribute("aria-selected", "true");
  await expect(navigation).toBeVisible();

  await bots.tap();
  await expect(bots).toHaveAttribute("aria-selected", "true");
  await expect(agents).toHaveAttribute("aria-selected", "false");
  await expect(navigation).toBeHidden();
  await expect(screen.getByPlaceholder("Search bots")).toBeVisible();
  await expect(screen.getByPlaceholder("Search sessions")).toHaveCount(0);
  await expect(screen.getByRole("button", "New bot")).toBeVisible();
  await expect(screen.getByLabel(/^Scout,/u)).toBeVisible();

  await hui.reload();
  await expect(screen.getByRole("tab", "Bots")).toHaveAttribute("aria-selected", "true");
  await expect(screen.getByPlaceholder("Search bots")).toBeVisible();
  await expect(screen.getByLabel("Primary navigation")).toBeHidden();

  await screen.getByLabel(/^Scout,/u).tap();
  await expect.poll(() => hui.url()).toMatch(/\/bots\//u);
  await expect(screen.getByRole("tab", "Bots")).toHaveAttribute("aria-selected", "true");
  await expect(screen.getByLabel("Primary navigation")).toBeHidden();

  // A phone keeps the same tabs in the navigation drawer.
  await hui.phoneScreen();
  await hui.sessionList();
  await expect(screen.getByRole("tab", "Bots")).toHaveAttribute("aria-selected", "true");
  await expect(screen.getByPlaceholder("Search bots")).toBeVisible();
  await expect(screen.getByLabel("Primary navigation")).toBeHidden();

  await screen.getByRole("tab", "Agents").tap();
  await expect(screen.getByRole("tab", "Agents")).toHaveAttribute("aria-selected", "true");
  await expect(screen.getByLabel("Primary navigation")).toBeVisible();
  await expect(screen.getByPlaceholder("Search sessions")).toBeVisible();
  await expect(screen.getByLabel("Sessions")).toBeVisible();
  await expect(screen.getByLabel(/^Scout,/u)).toBeHidden();
});
