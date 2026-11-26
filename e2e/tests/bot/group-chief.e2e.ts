/** A custom project group's menu creates its own Chief of Staff, in the bot folder HUI keeps for it rather than in the
 * project, with the pack's skills; asking again opens that same chief, and the group keeps its own sessions (BOT-072). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";
import { panelOverview } from "./bot-panel.ts";

type Bots = { bots: Array<{ id: string; group?: string; name: string; cwd: string }> };
type Listed = { groups: Array<{ label: string; sessions: Array<{ id: string }> }> };

test("a custom group's menu creates one Chief of Staff working in its own folder, not in the project", { tags: ["BOT-072"] }, async ({ screen, hui }) => {
  const group = "Chief Group E2E";
  // A group is a project with a directory and no sessions of its own: a chief no longer needs a session to exist first.
  await hui.api("POST", "/__hui/session-groups", { name: group, cwd: hui.workspace });
  await hui.open("/");
  // The group's header and its menu live in the sidebar, which a phone keeps in its drawer: the fixture opens the drawer
  // and waits for it, where reading the shell once for an Open navigation button would skip a shell it had not drawn yet.
  await hui.sessionList();
  await screen.getByRole("button", `Group options for ${group}`).tap();
  await screen.getByText("Create Chief of Staff", { exact: true, visible: true }).first().tap();

  // Creating the bot also creates its conversation and writes its skills: wait for it instead of racing the request.
  const chiefs = async () => (await hui.api<Bots>("GET", "/__hui/bots")).bots.filter((bot) => bot.group === group);
  await expect.poll(async () => (await chiefs()).length, { timeout: 60_000 }).toBe(1);
  const [chief] = await chiefs();
  expect(chief!.name).toBe(`Chief of Staff · ${group}`);
  // Its chat works in the folder HUI keeps for it; the group's directory is only where the sessions it starts run.
  const ownFolder = `${hui.configDir}/bots/${chief!.id}`;
  expect(chief!.cwd).toBe(ownFolder);
  expect(chief!.cwd).not.toBe(hui.workspace);
  await expect.poll(() => hui.url()).toContain(`/bots/${chief!.id}`);

  // Its own pack skills are installed and editable, and its Settings page names the folder it works in.
  const panel = await panelOverview(screen, chief!.name);
  await expect(panel.getByRole("button", /^Tools & skills/u)).toBeVisible();
  const workspaceRow = screen.getByRole("button", /^Workspace /u);
  await expect(workspaceRow).toContainText("Its own folder");
  await workspaceRow.tap();
  const workspace = panel.getByRole("region", "Workspace");
  await expect(workspace.getByText("Where it works. Can change only while it is idle.")).toBeVisible();
  await expect(workspace.getByRole("combobox", "Directory")).toHaveValue(ownFolder);

  // The project it belongs to still holds no sessions of its own.
  const groupSessions = async () => (await hui.api<Listed>("GET", "/__hui/sessions")).groups.find((entry) => entry.label === group)?.sessions ?? [];
  expect(await groupSessions()).toEqual([]);

  // Asking again opens the same chief instead of creating a second one.
  await hui.api("POST", "/__hui/staff/chiefs", { group });
  expect((await chiefs()).map((bot) => bot.id)).toEqual([chief!.id]);
});
