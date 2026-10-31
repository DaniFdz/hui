/** A group can name the remote worker its sessions start on, and New Session opens there (SESS-063). */
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

const GROUP = "HUI repo";
const WORKER = "Remote box";

test("New session defaults name a worker, and New Session from that group opens on it", { tags: ["SESS-063"], platforms: ["web"] }, async ({ screen, hui }) => {
  const repo = join(hui.workspace, "repo");
  await mkdir(repo, { recursive: true });
  const git = (...args: string[]) => execFileSync("git", ["-C", repo, "-c", "user.email=e2e@example.test", "-c", "user.name=E2E", ...args]);
  git("init", "-b", "main");
  await writeFile(join(repo, "notes.txt"), "Fixture repository\n");
  git("add", ".");
  git("commit", "-m", "Fixture commit");
  git("branch", "release/1.0");

  await hui.api("POST", "/__hui/session-groups", { name: GROUP });
  const worker = await hui.addWorker(WORKER);
  const plainFolder = join(worker.home, "plain-folder");
  await mkdir(plainFolder, { recursive: true });
  const remoteRepo = join(worker.home, "checkout");
  await mkdir(remoteRepo, { recursive: true });
  const remoteGit = (...args: string[]) => execFileSync("git", ["-C", remoteRepo, "-c", "user.email=e2e@example.test", "-c", "user.name=E2E", ...args]);
  remoteGit("init", "-b", "main");
  await writeFile(join(remoteRepo, "notes.txt"), "The worker's own checkout\n");
  remoteGit("add", ".");
  remoteGit("commit", "-m", "Fixture commit");
  await hui.open("/");

  const dialog = () => screen.getByLabel(/^New session defaults for/u);
  const directory = () => dialog().getByPlaceholder("~/");
  const runOn = () => dialog().getByRole("button", /^Run on/u);
  const save = () => dialog().getByRole("button", "Save");
  const openDefaults = async () => {
    await screen.getByRole("button", `Group options for ${GROUP}`).tap();
    await screen.getByText("New session defaults").tap();
  };
  /** Type a directory, then dismiss the suggestion list the way a reader leaves it: the list resizes the dialog. */
  const fillDirectory = async (value: string) => {
    await directory().fill(value);
    await dialog().getByText("Run on").tap();
    await expect(directory()).toHaveAttribute("aria-expanded", "false");
  };

  await openDefaults();
  await expect(runOn()).toContainText("Local");
  await fillDirectory(repo);
  await expect(dialog().getByText("Base branch")).toBeVisible();

  // On a worker the dialog asks that machine: a plain folder has no Git choices, its checkout does.
  await runOn().tap();
  await dialog().getByText(WORKER).tap();
  await expect(runOn()).toContainText(WORKER);
  await fillDirectory(plainFolder);
  await expect(dialog().getByText("Base branch")).toHaveCount(0);
  await fillDirectory(remoteRepo);
  await expect(dialog().getByText("Base branch")).toBeVisible();
  await fillDirectory("srv");
  await save().tap();
  await expect(dialog().getByText(/absolute or start with ~\//u)).toBeVisible();
  await fillDirectory(remoteRepo);
  await save().tap();
  await expect(dialog()).toHaveCount(0);

  // The saved machine survives a reload, and New Session opens on it.
  await hui.reload();
  await openDefaults();
  await expect(runOn()).toContainText(WORKER);
  await dialog().getByRole("button", "Cancel").tap();
  await screen.getByRole("button", "New session in HUI REPO").tap();
  await expect(screen.getByLabel("Choose where the session runs")).toContainText(WORKER);
  await expect(screen.getByPlaceholder("~/")).toHaveValue(remoteRepo);

  // Choosing Local clears it again.
  await openDefaults();
  await runOn().tap();
  await dialog().getByText("Local").tap();
  await save().tap();
  await hui.reload();
  await openDefaults();
  await expect(runOn()).toContainText("Local");
  await dialog().getByRole("button", "Cancel").tap();
});
