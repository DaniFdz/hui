/** With a worker connected the roster's + offers New bot on Local and New bot on <worker>, whose choice creates the bot
 * there and opens its chat with the machine's name in the header and the roster, its first message from that machine,
 * and Settings saying Runs on <worker> with that machine's folders and what stays here (BOT-064). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";
import { panelOverview, roster } from "./bot-panel.ts";

type BotRecord = { id: string; name: string; sessionId: string; cwd: string; worker?: { id: string; name: string } };

test("a worker's + offers New bot on Local and New bot on the worker, whose choice opens a chat with the machine in its header and roster, its first message from there and Settings naming that machine and its folders", { tags: ["BOT-064"], platforms: ["web"] }, async ({ screen, hui }) => {
  const name = "Far box";
  const worker = await hui.addWorker(name);
  await hui.open("/");
  await roster(screen, hui);

  // A worker exists, so the + names the machine each new bot would run on.
  await screen.getByRole("button", "New bot").tap();
  await expect(screen.getByText("New bot on Local")).toBeVisible();
  await expect(screen.getByText(`New bot on ${name}`)).toBeVisible();
  await screen.getByText(`New bot on ${name}`).tap();

  // The bot is created there and its chat opens: the header carries the machine, and its first message comes from there.
  const header = screen.getByTestId("chat-header");
  await expect(header.getByText(name)).toBeVisible();
  await expect(screen.getByTestId("transcript").getByText("Hi, I'm new here and I don't have a name yet. What would you like to call me?")).toBeVisible();
  const bot = (await hui.api<{ bots: BotRecord[] }>("GET", "/__hui/bots")).bots.find((each) => each.worker?.id === worker.id) as BotRecord;
  expect(bot.name).toBe("New Bot");
  expect(bot.worker).toEqual({ id: worker.id, name });
  expect(bot.cwd).toContain(worker.home);
  expect((await hui.api<{ groups: { sessions: { id: string; worker?: { id: string } }[] }[] }>("GET", "/__hui/sessions")).groups
    .flatMap((group) => group.sessions).find((session) => session.id === bot.sessionId)?.worker?.id).toBe(worker.id);
  await roster(screen, hui);
  await expect(screen.getByLabel(new RegExp(`^New Bot, on ${name}, `, "u"))).toBeVisible();

  // Settings names the machine, read-only, with a folder on it and what it cannot use from there.
  const panel = await panelOverview(screen, "New Bot");
  await screen.getByRole("button", /^Workspace /u).tap();
  const workspace = panel.getByRole("region", "Workspace");
  await expect(workspace).toBeVisible();
  const text = await hui.textOf(workspace);
  expect(text).toContain(`Runs on ${name}`);
  expect(text).toContain(`A folder on ${name}. Can change only while it is idle.`);
  expect(text).toContain("A bot stays on the machine it was created on: its chat and memory live there.");
  expect(text).toContain("Watchers stay on this machine, so it can't use them; it browses in its own, and its terminal is a shell there.");
  const directory = workspace.getByRole("combobox", "Directory");
  await expect(directory).toHaveValue(bot.cwd);

  // Its folders are the ones on that machine: the picker answers with the worker's own home-relative folder.
  const parent = bot.cwd.slice(0, bot.cwd.lastIndexOf("/"));
  await directory.fill(parent);
  const suggestions = screen.getByRole("listbox", "Directory");
  await expect(suggestions.getByRole("option", { name: /^~\/\.local\/share\/hui-worker\/bots\/$/u })).toBeVisible();
});
