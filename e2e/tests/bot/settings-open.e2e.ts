/** Opening a bot's Settings: the Settings chord on its chat opens the panel there and pressed again closes it (BOT-025), and Edit bot… in a roster row's menu or the chat header's, or Edit on the overview, opens its chat with the panel on Settings while a Setup row opens Settings at its own section (BOT-026). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

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
  await screen.getByRole("tab", "Bots").tap();
  const row = screen.getByLabel(/^Solo,/u);
  const panel = screen.getByLabel("Solo: bot panel");
  const header = screen.getByTestId("chat-header");

  await hui.peek(row);
  await screen.getByRole("button", "Actions for Solo").tap();
  await screen.getByText("Edit bot…", { exact: true, visible: true }).tap();
  await expect.poll(() => hui.url()).toMatch(new RegExp(`/bots/${bot.id}$`, "u"));
  await expect(header).toBeVisible();
  await expect(panel.getByLabel("Settings")).toBeVisible();
  await expect(panel.getByRole("textbox", "Name")).toHaveValue("Solo");

  await hui.open("/");
  await expect(screen.getByRole("tab", "Bots")).toBeVisible();
  await screen.getByLabel(/^Solo,/u).tap();
  await expect(screen.getByLabel("About Solo")).toBeVisible();
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
