/** A group's New session starts in that group and directory, its saved Git defaults survive a reload, a cancel and a non-Git directory, and New Session launches with them (SESS-005, SESS-028, SESS-029). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

type Listed = { groups: { label: string; cwd?: string; workspaceMode?: string; baseRef?: string; sessions: { id: string; title: string; cwd: string }[] }[] };

test("New session in a group selects it and its directory, and the Group picker can change it", { tags: ["SESS-005"], platforms: ["web"] }, async ({ screen, hui }) => {
  const groupSize = async (label: string) => (await hui.api<Listed>("GET", "/__hui/sessions")).groups.find((group) => group.label === label)?.sessions.length;
  await hui.createSession({ title: "Alpha anchor", group: "Alpha" });
  await hui.createSession({ title: "Beta anchor", group: "Beta" });
  const chooser = screen.getByLabel("Choose session group");

  await hui.open("/");
  await hui.peek(screen.getByText("ALPHA", { exact: true, visible: true }));
  await screen.getByRole("button", "New session in ALPHA").tap();
  await expect(chooser).toContainText("ALPHA");
  await expect(screen.getByLabel("Project directory")).toHaveValue(hui.workspace);

  await chooser.tap();
  await screen.getByLabel("Session group").getByText("BETA", { exact: true }).tap();
  await expect(chooser).toContainText("BETA");
  await screen.getByPlaceholder("What should this session work on?").fill("Hello Beta");
  await screen.getByRole("button", "Start session").tap();

  await expect(screen.getByTestId("transcript").getByText("Fixture response.")).toBeVisible();
  await expect(screen.getByText("durable · BETA · Idle", { visible: true })).toBeVisible();
  await expect.poll(() => groupSize("Beta")).toBe(2);
  expect(await groupSize("Alpha")).toBe(1);
});

test("a group's Git defaults are saved, survive a reload and a cancel, start sessions with them, and clear on a non-Git directory", { tags: ["SESS-028", "SESS-029"], platforms: ["web"] }, async ({ screen, hui }) => {
  const repository = await hui.repository();
  const existing = await hui.createSession({ title: "Defaults anchor", group: "Defaults" });
  const listed = async () => (await hui.api<Listed>("GET", "/__hui/sessions")).groups;
  const group = async () => (await listed()).find(({ label }) => label === "Defaults");
  const cwdOf = async (title: string) => (await listed()).flatMap(({ sessions }) => sessions).find((session) => session.title === title)?.cwd;
  const head = () => repository.git("branch", "--show-current");
  const branches = repository.git("branch", "--format=%(refname:short)");
  const directory = screen.getByPlaceholder("~/");
  const environment = screen.getByLabel(/^Environment: /u);
  const base = screen.getByLabel(/^Base branch: /u);
  const save = screen.getByRole("button", "Save");
  const choose = async (path: string, blur: string) => {
    await directory.fill(path);
    await screen.getByText(blur).tap();
  };
  const choosePath = (path: string) => choose(path, "Choose where sessions created from this group start.");
  const launchFrom = (path: string) => choose(path, "Pick where this session works, then say what to do.");
  const openDefaults = async () => {
    await hui.peek(screen.getByText("DEFAULTS", { exact: true, visible: true }));
    await screen.getByRole("button", "Group options for Defaults").tap();
    await screen.getByText("New session defaults", { visible: true }).tap();
    await expect(screen.getByText("New session defaults for “DEFAULTS”")).toBeVisible();
    await screen.getByText("Choose where sessions created from this group start.").tap();
  };
  const startFromGroup = async (prompt: string) => {
    await hui.peek(screen.getByText("DEFAULTS", { exact: true, visible: true }));
    await screen.getByRole("button", "New session in DEFAULTS").tap();
    await expect(directory).toHaveValue(repository.path);
    await screen.getByPlaceholder("What should this session work on?").fill(prompt);
  };

  await hui.open(`/sessions/${existing.id}`);
  await openDefaults();
  await expect(directory).toHaveValue(hui.workspace);
  await expect(environment).toBeHidden();
  await choosePath(repository.path);
  await expect(screen.getByLabel("Environment: Branch · Work in the current checkout.")).toBeVisible();
  await expect(screen.getByLabel("Base branch: main")).toBeVisible();
  await environment.tap();
  await screen.getByLabel("Environment", { exact: true }).getByText("New worktree").tap();
  await base.tap();
  await screen.getByLabel("Base branch", { exact: true }).getByText("release/1.0").tap();
  await expect(screen.getByLabel("Base branch: release/1.0")).toBeVisible();
  await save.tap();
  await expect(screen.getByText("New session defaults for “DEFAULTS”")).toBeHidden();
  expect(head()).toBe("feature/current");
  expect(repository.git("branch", "--format=%(refname:short)")).toBe(branches);
  expect(await cwdOf("Defaults anchor")).toBe(hui.workspace);

  await hui.reload();
  await openDefaults();
  await expect(directory).toHaveValue(repository.path);
  await expect(screen.getByLabel("Environment: New worktree · Start each session in an isolated Git worktree.")).toBeVisible();
  await expect(screen.getByLabel("Base branch: release/1.0")).toBeVisible();
  await environment.tap();
  await screen.getByLabel("Environment", { exact: true }).getByText("Branch").tap();
  await expect(screen.getByLabel("Environment: Branch · Work in the current checkout.")).toBeVisible();
  await screen.getByRole("button", "Cancel").tap();
  await openDefaults();
  await expect(screen.getByLabel("Environment: New worktree · Start each session in an isolated Git worktree.")).toBeVisible();
  await screen.getByRole("button", "Cancel").tap();

  await startFromGroup("Work on the release");
  const checkout = screen.getByLabel(/^Checkout: /u);
  await expect(screen.getByLabel("Checkout: New worktree from release/1.0")).toBeVisible();
  await launchFrom(`${repository.path}/sub`);
  await expect(screen.getByLabel("Checkout: main")).toBeVisible();
  await launchFrom(repository.path);
  await expect(screen.getByLabel("Checkout: New worktree from release/1.0")).toBeVisible();
  await checkout.tap();
  await screen.getByPlaceholder("Generated from the prompt").fill("e2e-release");
  await screen.getByText("Pick where this session works, then say what to do.").tap();
  await expect(screen.getByPlaceholder("Generated from the prompt")).toBeHidden();
  await screen.getByRole("button", "Start session").tap();
  await expect(screen.getByTestId("transcript").getByText("Fixture response.")).toBeVisible();
  await expect(screen.getByText("durable · DEFAULTS · Idle", { visible: true })).toBeVisible();
  const worktree = await cwdOf("Work on the release");
  expect(worktree).not.toBe(repository.path);
  expect(repository.git("-C", worktree!, "branch", "--show-current")).toBe("feature/e2e-release");
  expect(repository.git("rev-parse", "feature/e2e-release^{commit}")).toBe(repository.git("rev-parse", "release/1.0^{commit}"));
  expect(head()).toBe("feature/current");

  await openDefaults();
  await environment.tap();
  await screen.getByLabel("Environment", { exact: true }).getByText("Branch").tap();
  await base.tap();
  await screen.getByLabel("Base branch", { exact: true }).getByText("main").tap();
  await save.tap();
  await expect(screen.getByText("New session defaults for “DEFAULTS”")).toBeHidden();
  expect(head()).toBe("feature/current");

  await startFromGroup("Work on main");
  await expect(screen.getByLabel("Checkout: main")).toBeVisible();
  await screen.getByRole("button", "Start session").tap();
  await expect(screen.getByTestId("transcript").getByText("Fixture response.")).toBeVisible();
  expect(await cwdOf("Work on main")).toBe(repository.path);
  expect(head()).toBe("main");
  expect(await cwdOf("Work on the release")).toBe(worktree);
  expect(await cwdOf("Defaults anchor")).toBe(hui.workspace);

  await openDefaults();
  await choosePath(hui.workspace);
  await expect(environment).toBeHidden();
  await expect(base).toBeHidden();
  await save.tap();
  await expect(screen.getByText("New session defaults for “DEFAULTS”")).toBeHidden();
  await hui.reload();
  await openDefaults();
  await expect(directory).toHaveValue(hui.workspace);
  await expect.poll(async () => { const { cwd, workspaceMode, baseRef } = (await group())!; return { cwd, workspaceMode, baseRef }; })
    .toEqual({ cwd: hui.workspace, workspaceMode: undefined, baseRef: undefined });
});
