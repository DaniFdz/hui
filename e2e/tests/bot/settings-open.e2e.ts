/** Opening a bot's Settings: the Settings chord on its chat opens the panel there and pressed again closes it (BOT-025), and Edit bot… in a roster row's menu or the chat header's, or Edit on the overview, opens its chat with the panel on Settings while a Setup row opens Settings at its own section (BOT-026). */
import { expect, type Locator, type Screen } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";
import { hideBotPanel, panelOverview } from "./bot-panel.ts";

/** A roster row's ⋯: a phone draws it on the row, and the wide layout reveals it to the pointer first. */
const rowMenu = async (screen: Screen, hui: Hui, name: string): Promise<Locator> => {
  const menu = screen.getByRole("button", `Actions for ${name}`);
  if (!(await hui.reachable(menu))) await hui.peek(screen.getByLabel(new RegExp(`^${name},`, "u")));
  await expect(menu).toBeVisible();
  return menu;
};

test("the Settings chord on a bot's chat opens the panel on Settings and pressed again closes it", { tags: ["BOT-025"], platforms: ["web"] }, async ({ screen, hui }) => {
  const bot = (await hui.api<{ bot: { id: string } }>("POST", "/__hui/bots", { name: "Solo", title: "Fixture helper", soul: "# Who I am\nA fixture bot.\n" })).bot;
  await hui.open(`/bots/${bot.id}`);
  const panel = screen.getByLabel("Solo: bot panel");
  const header = screen.getByTestId("chat-header");
  await expect(screen.getByLabel("About Solo")).toBeVisible();

  await hui.settingsChord();
  await expect(panel.getByLabel("Settings")).toBeVisible();
  await expect(screen.getByRole("button", "Back to Solo")).toBeVisible();
  await hui.settingsChord();
  await expect(panel).toBeHidden();
  await expect(header).toBeVisible();
  await expect(screen.getByRole("button", "Show the bot panel")).toBeVisible();
});

test("Edit bot… in a roster row's menu or the chat header's, or Edit on the overview, opens the chat with the panel on Settings, and a Setup row opens Settings at its own section", { tags: ["BOT-026"], platforms: ["web"] }, async ({ screen, hui }) => {
  const bot = (await hui.api<{ bot: { id: string } }>("POST", "/__hui/bots", { name: "Solo", title: "Fixture helper", soul: "# Who I am\nA fixture bot.\n" })).bot;
  await hui.open("/");
  // A phone keeps the roster in the navigation drawer; on the wide layout this is nothing.
  await hui.sessionList();
  await screen.getByRole("tab", "Bots").tap();
  const panel = screen.getByLabel("Solo: bot panel");
  const header = screen.getByTestId("chat-header");

  await (await rowMenu(screen, hui, "Solo")).tap();
  await screen.getByText("Edit bot…", { exact: true, visible: true }).tap();
  await expect.poll(() => hui.url()).toMatch(new RegExp(`/bots/${bot.id}$`, "u"));
  await expect(header).toBeVisible();
  await expect(panel.getByLabel("Settings")).toBeVisible();
  await expect(panel.getByRole("textbox", "Name")).toHaveValue("Solo");

  await hui.open("/");
  await hui.sessionList();
  await expect(screen.getByRole("tab", "Bots")).toBeVisible();
  await screen.getByLabel(/^Solo,/u).tap();
  await expect.poll(() => hui.url()).toMatch(new RegExp(`/bots/${bot.id}$`, "u"));
  // The panel is a sheet over the chat on a phone, so the chat's own menu is reachable once it is put away.
  await panelOverview(screen, "Solo");
  await hideBotPanel(screen);
  await header.getByRole("button", "Actions for Solo").tap();
  await screen.getByText("Edit bot…", { exact: true, visible: true }).tap();
  await expect(panel.getByLabel("Settings")).toBeVisible();

  await screen.getByRole("button", "Back to Solo").tap();
  await expect(screen.getByLabel("About Solo")).toBeVisible();
  await screen.getByRole("button", "Edit Solo").tap();
  await expect(panel.getByLabel("Settings")).toBeVisible();

  await screen.getByRole("button", "Back to Solo").tap();
  await expect(screen.getByLabel("About Solo")).toBeVisible();
  await screen.getByRole("button", /^Workspace/u).tap();
  await expect(panel.getByLabel("Settings")).toBeVisible();
  await expect(panel.getByText("Workspace", { exact: true })).toBeFocused();
});
