/** BOT-001: the Agents | Bots switch swaps the sidebar's list and keeps the navigation. */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

const soul = "# Who I am\nA bot that keeps the tabs honest.\n";

test("the Agents | Bots switch swaps the list, keeps the navigation ending with Settings, and survives a reload", { tags: ["BOT-001"], platforms: ["web"] }, async ({ screen, hui }) => {
  const { bot } = await hui.api<{ bot: { id: string } }>("POST", "/__hui/bots", { name: "Tab Bot", title: "Keeps the tabs honest", soul });

  try {
    await hui.open("/");
    await hui.sessionList();
    const navigation = screen.getByTestId("primary-navigation");
    await expect(navigation).toBeVisible();
    await expect.poll(() => hui.textOf(navigation)).toBe("Dashboard Contributions Kanban Sessions Usage Settings");
    await expect(screen.getByRole("tab", "Agents")).toHaveAttribute("aria-selected", "true");

    // Bots swaps the session list for the roster and keeps the destinations.
    await screen.getByRole("tab", "Bots").tap();
    await expect(screen.getByRole("tab", "Bots")).toHaveAttribute("aria-selected", "true");
    await expect(navigation).toBeVisible();
    await expect.poll(() => hui.textOf(navigation)).toBe("Dashboard Contributions Kanban Sessions Usage Settings");
    await expect(screen.getByPlaceholder("Search bots")).toBeVisible();
    await expect(screen.getByText("Tab Bot")).toBeVisible();

    // The browser remembers the tab.
    await hui.reload();
    await hui.sessionList();
    await expect(screen.getByRole("tab", "Bots")).toHaveAttribute("aria-selected", "true");
    await expect(navigation).toBeVisible();

    // A bot's address opens on the Bots tab, with the same navigation.
    await hui.open(`/bots/${bot.id}`);
    await hui.sessionList();
    await expect(screen.getByRole("tab", { name: "Bots", selected: true })).toBeVisible();
    await expect(navigation).toBeVisible();
  } finally {
    await hui.api("DELETE", `/__hui/bots/${bot.id}?permanent=1`);
  }
});
