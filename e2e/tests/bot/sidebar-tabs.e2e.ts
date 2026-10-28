/** The sidebar's Agents | Bots switch: always offered, with no setting that turns bots off or on, Bots showing the roster alone with Search bots and its +, the choice kept over a reload, a bot's page keeping the Bots tab, and the drawer on a phone showing the same (BOT-001). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

type Settings = { labs: Record<string, boolean>; [key: string]: unknown };

test("the sidebar always offers Agents and Bots with no setting behind them, Bots shows the roster alone, the choice survives a reload and a bot's page and the phone drawer keep it", { tags: ["BOT-001"], platforms: ["web"] }, async ({ screen, hui }) => {
  const agents = screen.getByRole("tab", /^Agents/u);
  const bots = screen.getByRole("tab", /^Bots/u);

  await hui.open("/");
  await expect(agents).toHaveAttribute("aria-selected", "true");
  await expect(bots).toBeVisible();
  const settings = await hui.api<Settings>("GET", "/__hui/settings");
  const saved = await hui.api<Settings>("PUT", "/__hui/settings", { ...settings, labs: { ...settings.labs, bots: false } });
  expect(saved.labs).toEqual({ denseObservability: false, detailedDebug: false });
  await hui.reload();
  await expect(bots).toBeVisible();

  await bots.tap();
  await expect(bots).toHaveAttribute("aria-selected", "true");
  await expect(screen.getByPlaceholder("Search bots")).toBeVisible();
  await expect(screen.getByText("No bots yet", { exact: true })).toBeVisible();
  expect(await screen.getByRole("button", "New bot").count()).toBe(2);
  await expect(screen.getByTestId("nav-item")).toHaveCount(0);

  await hui.reload();
  await expect(bots).toHaveAttribute("aria-selected", "true");
  await expect(screen.getByPlaceholder("Search bots")).toBeVisible();

  const bot = (await hui.api<{ bot: { id: string } }>("POST", "/__hui/bots", { name: "Solo", title: "Fixture helper", soul: "# Who I am\nA fixture bot.\n" })).bot;
  await hui.open(`/bots/${bot.id}`);
  await expect(bots).toHaveAttribute("aria-selected", "true");
  await expect(screen.getByLabel(/^Solo,/u)).toBeVisible();
  await expect(screen.getByTestId("nav-item")).toHaveCount(0);

  await hui.phoneScreen();
  await screen.getByRole("button", "Open navigation").tap();
  await expect(bots).toHaveAttribute("aria-selected", "true");
  await agents.tap();
  await expect(agents).toHaveAttribute("aria-selected", "true");
  await expect(screen.getByPlaceholder("Search sessions")).toBeVisible();
  expect(await screen.getByTestId("nav-item").count()).toBeGreaterThan(0);
  await bots.tap();
  await expect(bots).toHaveAttribute("aria-selected", "true");
  await expect(screen.getByPlaceholder("Search bots")).toBeVisible();
  await expect(screen.getByTestId("nav-item")).toHaveCount(0);
  await expect(screen.getByLabel(/^Solo,/u)).toBeVisible();
});
