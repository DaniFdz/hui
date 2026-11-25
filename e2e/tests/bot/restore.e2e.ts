/** Show archived (N) lists archived bots with Restore and Delete, an archived bot's address says so and restores it there,
 * and Restore from either brings it back to the roster with "Restored <name>. Its routines stay paused until you turn them
 * on." while its chat opens again only once it is restored (BOT-015). */
import { expect } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";
import { roster } from "./bot-panel.ts";

const makeBot = async (hui: Hui, name: string) =>
  (await hui.api<{ bot: { id: string; sessionId: string } }>("POST", "/__hui/bots", { name, soul: "# Who I am\nA terse fixture bot.\n" })).bot;

const enabledRoutines = async (hui: Hui, sessionId: string) =>
  (await hui.api<{ tasks: { sessionId: string; enabled: boolean }[] }>("GET", "/__hui/automation")).tasks
    .filter((task) => task.sessionId === sessionId).map((task) => task.enabled);

test("Show archived lists archived bots with Restore and Delete, and Restore from the list or the bot's own address brings it back with its routines paused and its chat open again", { tags: ["BOT-015"], platforms: ["web"] }, async ({ screen, hui }) => {
  const shelved = await makeBot(hui, "Shelved");
  await hui.api("POST", "/__hui/automation/tasks", {
    name: "Weekly sweep", sessionId: shelved.sessionId, prompt: "Sweep the week.", enabled: true,
    schedule: { kind: "cron", expression: "0 9 * * 1", timezone: "UTC" },
  });
  await hui.api("DELETE", `/__hui/bots/${shelved.id}`);

  await hui.open("/");
  await roster(screen, hui);
  const archived = screen.getByRole("button", "Show archived (1)");
  await expect(archived).toBeVisible();
  await expect(screen.getByLabel(/^Shelved,/u)).toBeHidden();
  await archived.tap();
  const list = screen.getByLabel("Archived bots");
  await expect(list.getByText("Shelved", { exact: true })).toBeVisible();
  // Delete shows on the row the pointer or the keyboard is on.
  await list.getByRole("button", "Restore Shelved").focus();
  await expect(list.getByRole("button", "Delete Shelved")).toBeVisible();
  await expect.poll(async () => enabledRoutines(hui, shelved.sessionId)).toEqual([false]);
  await list.getByRole("button", "Restore Shelved").tap();
  await expect(screen.getByText("Restored Shelved. Its routines stay paused until you turn them on.")).toBeVisible();
  await expect(screen.getByLabel(/^Shelved,/u)).toBeVisible();
  await expect(archived).toHaveCount(0);

  // An archived bot's address says why its chat is closed and restores it from there.
  const stranded = await makeBot(hui, "Stranded");
  await hui.api("DELETE", `/__hui/bots/${stranded.id}`);
  await hui.open(`/bots/${stranded.id}`);
  await expect(screen.getByText("Stranded is archived. Its chat and memory are kept; restore it to open the chat again.")).toBeVisible();
  await expect(screen.getByText("Say hi to Stranded")).toHaveCount(0);
  await screen.getByRole("button", "Restore").tap();
  await expect(screen.getByText("Restored Stranded. Its routines stay paused until you turn them on.")).toBeVisible();
  await expect(screen.getByText("Say hi to Stranded")).toBeVisible();
  await expect(screen.getByLabel("Stranded: bot panel")).toBeVisible();
});
