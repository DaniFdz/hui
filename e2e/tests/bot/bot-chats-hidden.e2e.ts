/** A bot's chat, and the subagents it spawns, stay out of every session list — the sidebar and its search, the Sessions
 * page, the command palette, the Kanban board and the scheduler's own session picker — while Automations labels the bot's
 * routine as its panel words it (BOT-017). */
import { expect } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";

type Listed = { groups: { label: string; sessions: { id: string; title: string; bot?: { id: string } }[] }[] };

const listed = async (hui: Hui) => (await hui.api<Listed>("GET", "/__hui/sessions")).groups.flatMap((group) => group.sessions);

test("a bot's chat and the subagents it spawns never appear in a session list, its search, the Kanban board, the palette or the scheduler's session picker, while Automations labels its routine as its panel does", { tags: ["BOT-017"], platforms: ["web"] }, async ({ screen, hui }) => {
  const bot = (await hui.api<{ bot: { id: string; name: string; handle: string; sessionId: string } }>("POST", "/__hui/bots", { name: "Quiet moon", soul: "# Who I am\nA terse fixture bot.\n" })).bot;
  const chat = (await listed(hui)).find((session) => session.id === bot.sessionId)!;
  await hui.api("POST", "/__hui/automation/tasks", {
    name: "Morning review", sessionId: bot.sessionId, prompt: "Review the night's changes.", enabled: true,
    schedule: { kind: "cron", expression: "0 8 * * *", timezone: "UTC" },
  });
  const child = await hui.createSubagent({ id: bot.sessionId });
  const control = "Zulu keeper";
  await hui.createSession({ title: control });
  expect(child.title).not.toBe(chat.title);

  // The sidebar lists the operator's session alone, on the Agents tab.
  await hui.open("/");
  await hui.sessionList();
  await screen.getByRole("tab", "Agents").tap();
  const row = (title: string) => screen.getByTestId("session-row").filter({ hasText: title });
  await expect(row(control)).toBeVisible();
  await expect(row(chat.title)).toBeHidden();
  await expect(row(child.title)).toBeHidden();

  // Its search matches nothing of the bot's, and says so.
  const search = screen.getByPlaceholder("Search sessions");
  await search.fill(chat.title);
  await expect(screen.getByText("No matching sessions.")).toBeVisible();
  await expect(row(chat.title)).toBeHidden();
  await search.fill(child.title);
  await expect(screen.getByText("No matching sessions.")).toBeVisible();
  await search.fill("");

  // The Sessions page lists the operator's session alone.
  await hui.open("/sessions");
  const pageRow = (title: string) => screen.getByTestId("session-data-row").filter({ hasText: title });
  await expect(pageRow(control)).toBeVisible();
  await expect(pageRow(chat.title)).toBeHidden();
  await expect(pageRow(child.title)).toBeHidden();

  // The command palette finds chats; the bot itself is a result it may jump to, its chat is not one.
  const input = screen.getByPlaceholder("Search or jump to…");
  const results = screen.getByTestId("command-palette-results");
  await hui.open("/");
  await hui.paletteChord();
  await input.fill(chat.title);
  await expect(results.getByText("Bots", { exact: true })).toBeVisible();
  await expect(results.getByRole("option", { name: /Quiet moon @quiet-moon/u })).toBeVisible();
  await expect(results.getByText("Chats", { exact: true })).toBeHidden();
  await input.fill(child.title);
  await expect(results.getByText("No results")).toBeVisible();
  await input.fill(control);
  await expect(results.getByText("Chats", { exact: true })).toBeVisible();
  await expect(results.getByText(control, { exact: true })).toBeVisible();
  await input.press("Escape");

  // The Kanban board draws the operator's session and neither of the bot's, with every session shown.
  await hui.open("/kanban");
  const board = screen.getByLabel("Kanban board");
  await expect(board.getByText(control)).toBeVisible();
  await expect(board.getByText(chat.title)).toBeHidden();
  await expect(board.getByText(child.title)).toBeHidden();
  await screen.getByRole("button", "Board options").tap();
  await screen.getByLabel("Board options").first().getByText("All", { visible: true }).tap();
  await expect(board.getByText(control)).toBeVisible();
  await expect(board.getByText(chat.title)).toBeHidden();
  await expect(board.getByText(child.title)).toBeHidden();

  // The scheduler's session picker offers the operator's session, never a bot chat.
  await hui.open("/settings/automation");
  await expect(screen.getByLabel("Session", { visible: true })).toBeVisible();
  await expect(screen.getByText(control, { exact: true })).toHaveCount(1);
  await expect(screen.getByText(chat.title, { exact: true })).toHaveCount(0);

  // Automations labels the bot's routine as its panel words it, with the panel's schedule.
  await hui.open("/cron");
  await expect(screen.getByRole("button", "Edit Morning review")).toBeVisible();
  await expect(screen.getByText("Bot · Quiet moon", { exact: true })).toBeVisible();
  await expect(screen.getByText("Daily at 08:00", { exact: true })).toBeVisible();
});
