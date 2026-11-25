/** The New group dialog sets a group's machine, project and Git defaults and creates its Chief of Staff in the same
 * submit, and refuses a chief with no project directory without creating anything (SESS-079). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";
import { roster } from "../bot/bot-panel.ts";

type Listed = { groups: { label: string; cwd?: string; worker?: string; workspaceMode?: string; baseRef?: string; sessions: { id: string }[] }[] };
type Bots = { bots: { id: string; name: string; group?: string; cwd: string }[] };

test("New group saves a group's machine, project and Git defaults with its Chief of Staff in one submit, and a chief with no directory creates nothing", { tags: ["SESS-079"], platforms: ["web"] }, async ({ screen, hui }) => {
  const group = "Project setup";
  const repository = await hui.repository();
  // A worker in the list, so Run on offers the machine this group's sessions and its chief would run on.
  await hui.api("POST", "/__hui/workers", { name: "Build box", command: "ssh nowhere" });
  const stored = async () => (await hui.api<Listed>("GET", "/__hui/sessions")).groups.find((entry) => entry.label === group);

  await hui.open("/");
  // The toolbar lives in the sidebar, which a phone keeps in its drawer.
  await hui.sessionList();
  await screen.getByRole("button", "New group").tap();
  const dialog = screen.getByRole("dialog", { name: "New group" });
  const directory = dialog.getByRole("combobox", "Working directory");
  const chiefChoice = dialog.getByRole("checkbox", { name: /^Create a Chief of Staff/u });
  const runOn = dialog.getByRole("button", /^Run on/u);
  await expect(directory).toBeVisible();
  await expect(chiefChoice).not.toBeChecked();
  await runOn.tap();
  const machines = screen.getByLabel("Run on", { exact: true });
  await expect(machines.getByRole("option", { name: /^Local/u })).toBeVisible();
  await expect(machines.getByRole("option", { name: /^Build box/u })).toBeVisible();
  await machines.getByRole("option", { name: /^Local/u }).tap();
  await expect(runOn).toContainText("Local");

  // A chief starts this group's sessions in its directory, so a chief with no directory is refused and creates nothing.
  await dialog.getByLabel("Group name").fill(group);
  await chiefChoice.tap();
  await expect(chiefChoice).toBeChecked();
  await dialog.getByRole("button", "Create group").tap();
  await expect(dialog.getByText("Choose a working directory first: a Chief of Staff starts this group's sessions there.")).toBeVisible();
  expect(await stored()).toBeUndefined();

  // One submit saves the project and its Git choices together, and creates the chief that works for it.
  await directory.fill(repository.path);
  await expect(dialog.getByText("Environment", { exact: true })).toBeVisible();
  // The suggestion list the field opens would cover the choices below it: leaving the field closes it.
  await dialog.getByText("New group", { exact: true }).tap();
  await expect(directory).toHaveAttribute("aria-expanded", "false");
  await dialog.getByLabel(/^Environment: /u).tap();
  await screen.getByLabel("Environment", { exact: true }).getByText("New worktree").tap();
  await expect(dialog.getByLabel("Environment: New worktree · Start each session in an isolated Git worktree.")).toBeVisible();
  await dialog.getByLabel(/^Base branch: /u).tap();
  await screen.getByLabel("Base branch", { exact: true }).getByText("release/1.0").tap();
  await expect(dialog.getByLabel("Base branch: release/1.0")).toBeVisible();
  await dialog.getByRole("button", "Create group").tap();
  await expect(dialog).toBeHidden();
  // The group holds the machine, directory and Git choices the dialog collected, and no session of its own.
  await expect.poll(async () => {
    const entry = await stored();
    return entry && { cwd: entry.cwd, worker: entry.worker, workspaceMode: entry.workspaceMode, baseRef: entry.baseRef, sessions: entry.sessions.length };
  }).toEqual({ cwd: repository.path, worker: undefined, workspaceMode: "worktree", baseRef: "release/1.0", sessions: 0 });

  // The group the dialog created is in the sidebar, and its chief works in its own folder rather than in the project it
  // starts sessions in.
  await hui.sessionList();
  await expect(screen.getByRole("button", "PROJECT SETUP")).toBeVisible();
  const chiefs = async () => (await hui.api<Bots>("GET", "/__hui/bots")).bots.filter((bot) => bot.group === group);
  await expect.poll(async () => (await chiefs()).length, { timeout: 60_000 }).toBe(1);
  const [chief] = await chiefs();
  expect(chief!.name).toBe(`Chief of Staff · ${group}`);
  expect(chief!.cwd).toBe(`${hui.configDir}/bots/${chief!.id}`);
  await roster(screen, hui);
  await expect(screen.getByLabel(new RegExp(`^Chief of Staff · ${group},`, "u"))).toBeVisible();
});
