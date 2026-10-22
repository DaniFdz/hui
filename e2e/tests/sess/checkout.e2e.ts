/** New Session's Checkout popover starts on the current branch, switches the checkout to another branch, or starts a new worktree named by the utility model, and links to the branch prefix setting (SESS-009, SESS-010, SESS-011). */
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { expect, type Screen } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";

type Listed = { groups: { sessions: { title: string; cwd: string }[] }[] };

const sessions = async (hui: Hui) => (await hui.api<Listed>("GET", "/__hui/sessions")).groups.flatMap((group) => group.sessions);

const chooseDirectory = async (screen: Screen, path: string) => {
  await screen.getByLabel("Project directory").fill(path);
  await screen.getByText("Pick where this session works, then say what to do.").tap();
};

test("the Checkout trigger shows the current branch, and Current checkout switches to a suggested branch before the session exists or shows Git's refusal", { tags: ["SESS-009"], platforms: ["web"] }, async ({ screen, hui }) => {
  const repository = await hui.repository();
  const head = () => repository.git("branch", "--show-current");
  const keep = join(repository.path, "sub", "keep.txt");
  await writeFile(keep, "feature\n");
  repository.git("commit", "--quiet", "-am", "feature keep");
  await writeFile(keep, "dirty\n");
  const from = screen.getByLabel("From");
  const suggestions = screen.getByLabel("Branch suggestions");
  const message = screen.getByPlaceholder("What should this session work on?");
  const start = screen.getByRole("button", "Start session");
  const transcript = screen.getByTestId("transcript");
  const before = await sessions(hui);

  await hui.open("/");
  await chooseDirectory(screen, repository.path);
  await screen.getByLabel("Checkout: feature/current").tap();
  await expect(screen.getByText("Current checkout")).toBeVisible();
  await expect(from).toHaveValue("");
  await expect(suggestions).toBeHidden();
  await from.tap();
  await expect(suggestions).toBeVisible();
  expect(await suggestions.getByText(/^(main|feature\/current|release\/1\.0)$/u).allTextContents()).toEqual(["main", "feature/current", "release/1.0"]);
  await expect(screen.getByText("Starts by switching this checkout to the selected branch or commit.")).toBeVisible();
  await expect(screen.getByPlaceholder("Generated from the prompt")).toBeHidden();
  await suggestions.getByText("release/1.0").tap();
  await expect(from).toHaveValue("release/1.0");
  await expect(suggestions).toBeHidden();
  await expect(screen.getByText("Current checkout")).toBeVisible();
  await expect(screen.getByLabel("Checkout: release/1.0")).toBeVisible();
  await expect(screen.getByPlaceholder("Generated from the prompt")).toBeHidden();

  await screen.getByText("Pick where this session works, then say what to do.").tap();
  await message.fill("Work on the release");
  await start.tap();
  await expect(screen.getByText("Could not start session")).toBeVisible();
  await expect(screen.getByText(/^Could not change Git checkout: error: Your local changes to the following files would be overwritten by checkout:/u)).toBeVisible();
  expect(await sessions(hui)).toEqual(before);
  expect(head()).toBe("feature/current");
  expect(repository.git("status", "--porcelain")).toBe("M sub/keep.txt");

  repository.git("checkout", "--", "sub/keep.txt");
  await start.tap();
  await expect.poll(async () => (await sessions(hui)).length).toBe(before.length + 1);
  expect(head()).toBe("release/1.0");
  expect((await sessions(hui)).find(({ title }) => title === "Work on the release")?.cwd).toBe(repository.path);
  await expect(transcript.getByText("Fixture response.")).toBeVisible();

  await hui.open("/");
  await chooseDirectory(screen, repository.path);
  await expect(screen.getByLabel("Checkout: release/1.0")).toBeVisible();
  await message.fill("Stay on the release");
  await start.tap();
  await expect(transcript.getByText("Stay on the release")).toBeVisible();
  expect(head()).toBe("release/1.0");
});

test("New worktree starts the session in a new checkout on a utility-named branch from the chosen ref", { tags: ["SESS-010"], platforms: ["web"] }, async ({ screen, hui }) => {
  const repository = await hui.repository();
  const settings = await hui.api<{ models: Record<string, string> }>("GET", "/__hui/settings");
  const { branchPrefix } = await hui.api<{ branchPrefix: string }>("PUT", "/__hui/settings",
    { ...settings, branchPrefix: "e2e", models: { ...settings.models, utility: "hui-e2e/fixture" } });
  expect(branchPrefix).toBe("e2e/");
  const name = screen.getByPlaceholder("Generated from the prompt");

  await hui.open("/");
  await chooseDirectory(screen, repository.path);
  await screen.getByLabel("Checkout: feature/current").tap();
  await screen.getByText("New worktree").tap();
  await expect(screen.getByLabel("Checkout: New worktree from feature/current")).toBeVisible();
  await expect(name).toBeVisible();
  await expect(name).toHaveValue("");
  await expect(screen.getByText("Creates branch e2e/<name> in a separate checkout.")).toBeVisible();
  await screen.getByLabel("From").tap();
  await screen.getByLabel("Branch suggestions").getByText("release/1.0").tap();
  await expect(screen.getByLabel("Checkout: New worktree from release/1.0")).toBeVisible();

  await screen.getByText("Pick where this session works, then say what to do.").tap();
  await screen.getByPlaceholder("What should this session work on?").fill("Tidy the launch form");
  await screen.getByRole("button", "Start session").tap();
  await expect(screen.getByTestId("transcript").getByText("Fixture response.")).toBeVisible();
  await expect.poll(async () => (await sessions(hui)).some(({ title }) => title === "Improve session naming")).toBe(true);
  const { cwd } = (await sessions(hui)).find(({ title }) => title === "Improve session naming")!;
  expect(cwd.startsWith(join(dirname(hui.workspace), "config", "hui", "worktrees") + "/")).toBe(true);
  expect(repository.git("-C", cwd, "branch", "--show-current")).toBe("e2e/improve-session-naming");
  expect(repository.git("-C", cwd, "rev-parse", "HEAD")).toBe(repository.git("rev-parse", "release/1.0^{commit}"));
  expect(repository.git("branch", "--show-current")).toBe("feature/current");
});

test("Configure default prefix opens the worktree settings scrolled to the branch prefix field", { tags: ["SESS-011"], platforms: ["web"] }, async ({ screen, hui }) => {
  const repository = await hui.repository();
  const phone = await hui.phoneScreen();

  await hui.open("/");
  await chooseDirectory(screen, repository.path);
  await screen.getByLabel("Checkout: feature/current").tap();
  await screen.getByText("New worktree").tap();
  await screen.getByText("Configure default prefix").tap();
  const prefix = screen.getByLabel("Workspace branch prefix");
  await expect(prefix).toBeVisible();
  await expect(prefix).toHaveValue("feature/");
  expect(new URL(await hui.url()).pathname).toBe("/settings/worktrees");
  const title = screen.getByTestId("settings-page-title");
  await expect(title).toHaveText("Worktrees");
  const header = screen.getByRole("button", "Open settings navigation");
  await expect.poll(async () => {
    const field = (await prefix.boundingBox())!;
    const top = (await title.boundingBox())!;
    const bar = (await header.boundingBox())!;
    return { fieldInView: field.y >= bar.y + bar.height && field.y + field.height <= phone.height, titleScrolledAway: top.y + top.height <= 0 };
  }).toEqual({ fieldInView: true, titleScrolledAway: true });
});
