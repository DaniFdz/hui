/** An archived bot's address says it is archived and its chat opens again only once it is restored; Restore from Show archived, from the archive notice or from that address brings it back to the roster with its routines still paused (BOT-015). */
import { expect } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";

type Tasks = { tasks: { name: string; sessionId: string; enabled: boolean }[] };

const notice = "Restored Solo. Its routines stay paused until you turn them on.";

async function archivedBot(hui: Hui) {
  const bot = (await hui.api<{ bot: { id: string; sessionId: string } }>("POST", "/__hui/bots", { name: "Solo", title: "Fixture helper", soul: "# Who I am\nA terse fixture bot.\n" })).bot;
  await hui.api("POST", "/__hui/automation/tasks", {
    name: "Morning check", sessionId: bot.sessionId, prompt: "Check the build.", enabled: true,
    schedule: { kind: "cron", expression: "0 8 * * *", timezone: "UTC" },
  });
  await hui.api("DELETE", `/__hui/bots/${bot.id}`);
  return bot;
}

test("the archived bot's address explains it, its chat opens only once it is restored, and Restore from Show archived, from the notice or from that address puts it back with its routines paused", { tags: ["BOT-015"], platforms: ["web"] }, async ({ screen, hui }) => {
  const bot = await archivedBot(hui);
  const row = screen.getByLabel(/^Solo,/u);
  const restored = () => expect(screen.getByText(notice, { exact: true }).first()).toBeVisible();
  const paused = async () => (await hui.api<Tasks>("GET", "/__hui/automation")).tasks.find((task) => task.sessionId === bot.sessionId && task.name === "Morning check")?.enabled;

  await hui.open(`/bots/${bot.id}`);
  await expect(screen.getByText("Solo is archived. Its chat and memory are kept; restore it to open the chat again.", { exact: true })).toBeVisible();
  await expect(screen.getByTestId("chat-header")).toHaveCount(0);
  await expect(screen.getByPlaceholder("Message")).toHaveCount(0);
  await screen.getByRole("button", "Restore").tap();
  await restored();
  await expect(screen.getByTestId("chat-header")).toBeVisible();
  await expect(row).toBeVisible();
  await expect.poll(paused).toBe(false);

  await hui.api("DELETE", `/__hui/bots/${bot.id}`);
  await hui.open("/");
  await expect(screen.getByRole("tab", /^Bots/u)).toBeVisible();
  await expect(screen.getByRole("button", "Show archived (1)")).toBeVisible();
  await screen.getByRole("button", "Show archived (1)").tap();
  const archivedRow = screen.getByRole("listitem").filter({ has: screen.getByRole("button", "Restore Solo") });
  await hui.peek(archivedRow);
  await expect(screen.getByRole("button", "Delete Solo")).toBeVisible();
  await screen.getByRole("button", "Restore Solo").tap();
  await restored();
  await expect(row).toBeVisible();
  await expect(screen.getByRole("button", "Show archived (1)")).toHaveCount(0);

  await hui.open(`/bots/${bot.id}`);
  await screen.getByTestId("chat-header").getByRole("button", "Actions for Solo").tap();
  await screen.getByText("Archive…", { exact: true, visible: true }).tap();
  await screen.getByRole("button", "Archive").tap();
  await expect(screen.getByText("Archived “Solo”. Its chat and memory are kept.", { exact: true })).toBeVisible();
  await expect(row).toHaveCount(0);
  await screen.getByRole("button", "Restore").tap();
  await restored();
  await expect(row).toBeVisible();
  await expect(screen.getByText("Archived “Solo”. Its chat and memory are kept.", { exact: true })).toHaveCount(0);

  await hui.open(`/bots/${bot.id}`);
  await expect(screen.getByRole("switch", "Enable Morning check")).toBeChecked({ checked: false });
  await expect.poll(paused).toBe(false);
});
