/** Settings → Workspace → Directory suggests folders from the machine the bot runs on and saves the one chosen, a folder that does not exist shows the gateway's refusal under the field, Escape puts the bot's folder back, and while the bot works the field is locked (BOT-030). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("the Directory field suggests the machine's folders and saves the one chosen, shows the refusal for a folder that does not exist, Escape puts the bot's folder back and a working bot locks it", { tags: ["BOT-030"], platforms: ["web"] }, async ({ screen, hui }) => {
  const bot = (await hui.api<{ bot: { id: string; cwd: string; sessionId: string } }>("POST", "/__hui/bots", { name: "Solo", title: "Fixture helper", soul: "# Who I am\nA fixture bot.\n" })).bot;
  const cwd = () => expect.poll(async () => (await hui.api<{ bot: { cwd: string } }>("GET", `/__hui/bots/${bot.id}`)).bot.cwd.replace(/\/$/u, ""));
  await hui.open(`/bots/${bot.id}`);
  await screen.getByRole("button", /^Workspace /u).tap();
  const directory = screen.getByPlaceholder("~/");
  const row = screen.getByTestId("bot-setting").filter({ has: directory });
  const expectHint = (text: RegExp) => expect(row).toHaveText(text);
  await expect(directory).toHaveValue(bot.cwd);

  const parent = hui.workspace.slice(0, hui.workspace.lastIndexOf("/"));
  await directory.fill(`${parent}/work`);
  await screen.getByText(`${hui.workspace}/`, { exact: true }).tap();
  await expect(directory).toHaveValue(`${hui.workspace}/`);
  await hui.keyboard.down("Enter");
  await hui.keyboard.up("Enter");
  await cwd().toBe(hui.workspace);
  await screen.getByRole("button", "Back to Solo").tap();
  await expect(screen.getByRole("button", /^Workspace …/u)).toBeVisible();

  await screen.getByRole("button", /^Workspace /u).tap();
  await directory.fill("/no/such/folder/that/does/not/exist");
  await hui.keyboard.down("Enter");
  await hui.keyboard.up("Enter");
  const error = row.getByText(/^No such directory: \/no\/such\/folder/u);
  await expect(error).toBeVisible();
  await expect.poll(async () => (await error.boundingBox())!.y > (await directory.boundingBox())!.y + (await directory.boundingBox())!.height - 1).toBe(true);
  await hui.keyboard.down("Escape");
  await hui.keyboard.up("Escape");
  await expect(directory).toHaveValue(`${hui.workspace}/`);
  await expect(row.getByText(/^No such directory/u)).toBeHidden();
  await cwd().toBe(hui.workspace);

  await screen.getByRole("button", "Back to Solo").tap();
  await hui.api("POST", `/__hui/sessions/${bot.sessionId}/prompt`, { text: "E2E_REPLAY" });
  await hui.provider.held();
  await screen.getByRole("button", /^Workspace /u).tap();
  await expectHint(/It is working\. The directory can change once it is idle\./u);
  await expect(directory).toBeDisabled();
  await hui.provider.release();
  await expectHint(/Where it works\. Can change only while it is idle\./u);
  await expect(directory).toBeEnabled();
});
