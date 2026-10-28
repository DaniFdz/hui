/** Archive… from a roster row or the chat header asks "Archive <name>?" with the focus on Cancel; Archive takes the bot off the roster, disables its routines, stops a running turn and shows the archived notice with Restore, and Cancel leaves everything as it was (BOT-014). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

type BotState = { archived?: boolean; status: string };
type Tasks = { tasks: { name: string; enabled: boolean }[] };

test("Archive… asks with the focus on Cancel and Archive takes the bot off the roster, disables its routines, stops its running turn and offers Restore, while Cancel leaves it as it was", { tags: ["BOT-014"], platforms: ["web"] }, async ({ screen, hui }) => {
  const bot = (await hui.api<{ bot: { id: string; sessionId: string } }>("POST", "/__hui/bots", { name: "Solo", title: "Fixture helper", soul: "# Who I am\nA fixture bot.\n" })).bot;
  await hui.api("POST", "/__hui/automation/tasks", {
    name: "Morning check", sessionId: bot.sessionId, prompt: "Check the build.", enabled: true,
    schedule: { kind: "cron", expression: "0 8 * * *", timezone: "UTC" },
  });
  const state = async () => (await hui.api<{ bot: BotState }>("GET", `/__hui/bots/${bot.id}`)).bot;
  const enabled = async () => (await hui.api<Tasks>("GET", "/__hui/automation")).tasks.find((task) => task.name === "Morning check")?.enabled;
  const notice = screen.getByText("Archived “Solo”. Its chat and memory are kept.", { exact: true });

  await hui.open(`/bots/${bot.id}`);
  await hui.api("POST", `/__hui/sessions/${bot.sessionId}/prompt`, { text: "E2E_REPLAY" });
  await hui.provider.held();
  await expect.poll(async () => (await state()).status).toBe("running");

  await screen.getByTestId("chat-header").getByRole("button", "Actions for Solo").tap();
  await screen.getByText("Archive…", { exact: true, visible: true }).tap();
  await expect(screen.getByText("Archive Solo?", { exact: true })).toBeVisible();
  const cancel = screen.getByRole("button", "Cancel");
  await expect(cancel).toBeFocused();
  await cancel.tap();
  await expect(screen.getByText("Archive Solo?", { exact: true })).toBeHidden();
  expect(await enabled()).toBe(true);
  await expect.poll(async () => (await state()).status).toBe("running");

  await hui.open("/");
  await screen.getByRole("tab", /^Bots/u).tap();
  const row = screen.getByLabel(/^Solo,/u);
  await hui.peek(row);
  await screen.getByRole("button", "Actions for Solo").tap();
  await screen.getByText("Archive…", { exact: true, visible: true }).tap();
  await expect(cancel).toBeFocused();
  await screen.getByRole("button", "Archive").tap();

  await expect(notice).toBeVisible();
  await expect(screen.getByRole("button", "Restore")).toBeVisible();
  await expect(row).toHaveCount(0);
  await expect.poll(enabled).toBe(false);
  await expect.poll(async () => {
    const archived = await state();
    return { archived: archived.archived === true, running: archived.status === "running" };
  }).toEqual({ archived: true, running: false });
  await hui.provider.release();
});
