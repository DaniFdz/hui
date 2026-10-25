/** The Work pane's Files view over a conversation's folder: the navigator, filtering by path, creating and deleting an
 * entry (WORK-042, 050, 052, 053). */
import { mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, type Locator } from "e2e";
import { test } from "../../fixtures/hui.ts";

/** A + menu entry, found by the shortcut only that kind shows. */
const item = (screen: Pick<Locator, "getByText">, key: string) => screen.getByText(new RegExp(`(?:⌥⇧⌘|Ctrl\\+Alt\\+Shift\\+|Alt\\+Shift\\+Ctrl\\+)${key}`, "u"));

test("Files in the plus menu lists the conversation's folder, folders first and without .git, expanding on demand", { tags: ["WORK-042"], platforms: ["web"] }, async ({ screen, hui }) => {
  const repository = await hui.repository();
  await writeFile(join(repository.path, "readme.md"), "# Notes\n");
  await mkdir(join(repository.path, "empty"));
  await symlink("/etc/hosts", join(repository.path, "outside"));
  const session = await hui.createSession({ title: "Browse files", cwd: repository.path });
  const navigator = screen.getByLabel("Files navigator");

  await hui.wideScreen();
  await hui.open(`/sessions/${session.id}`);
  await screen.getByRole("button", "Show Work pane").tap();
  await screen.getByRole("button", "Open Work view").tap();
  await item(screen, "F").first().tap();

  await expect(navigator.getByRole("button", "sub")).toBeVisible();
  const names = (await navigator.getByRole("listitem").allTextContents()).map((name) => name.trim());
  expect(names.slice(0, 2).sort()).toEqual(["empty", "sub"]);
  expect(names.sort()).toEqual(["empty", "outside link outside this folder", "readme.md", "sub"]);
  await expect(navigator.getByText(".git")).toHaveCount(0);
  await expect(navigator.getByText("link outside this folder")).toBeVisible();

  await expect(navigator.getByText("keep.txt", { exact: false })).toHaveCount(0);
  await navigator.getByRole("button", "sub").tap();
  await expect(navigator.getByRole("button", "keep.txt")).toBeVisible();
  await navigator.getByRole("button", "empty").tap();
  await expect(navigator.getByText("Empty folder")).toBeVisible();

  await expect(navigator.getByRole("button", "outside")).toHaveCount(0);
});

test("typing in Filter files lists the matching files with their folders and emptying it restores the tree", { tags: ["WORK-050"], platforms: ["web"] }, async ({ screen, hui }) => {
  const repository = await hui.repository();
  await writeFile(join(repository.path, "readme.md"), "# Notes\n");
  await writeFile(join(repository.path, "a-note.md"), "# Another\n");
  const session = await hui.createSession({ title: "Filter files", cwd: repository.path });
  const navigator = screen.getByLabel("Files navigator");
  const filter = navigator.getByLabel("Filter files");

  await hui.wideScreen();
  await hui.open(`/sessions/${session.id}`);
  await screen.getByRole("button", "Show Work pane").tap();
  await screen.getByRole("button", "Open Work view").tap();
  await item(screen, "F").first().tap();
  await expect(navigator.getByRole("button", "sub")).toBeVisible();

  await filter.fill("keep");
  await expect(navigator.getByRole("button", /keep\.txt/u)).toBeVisible();
  await expect(navigator.getByText("sub", { exact: true }).first()).toBeVisible();
  await expect(navigator.getByRole("button", "readme.md")).toHaveCount(0);

  await filter.fill("note");
  await expect(navigator.getByRole("button", /a-note\.md/u)).toBeVisible();
  await expect(navigator.getByRole("button", /keep\.txt/u)).toHaveCount(0);

  await filter.fill("");
  await expect(navigator.getByRole("button", "sub")).toBeVisible();
  await expect(navigator.getByRole("button", "readme.md")).toBeVisible();
  await expect(navigator.getByRole("button", /keep\.txt/u)).toHaveCount(0);
});

test("New file and New folder create the named entry and open a new file, and a name already taken keeps the dialog with its reason", { tags: ["WORK-052"], platforms: ["web"] }, async ({ screen, hui }) => {
  const repository = await hui.repository();
  const session = await hui.createSession({ title: "Create files", cwd: repository.path });
  const pane = screen.getByLabel("Work pane");
  const navigator = screen.getByLabel("Files navigator");

  await hui.wideScreen();
  await hui.open(`/sessions/${session.id}`);
  await screen.getByRole("button", "Show Work pane").tap();
  await screen.getByRole("button", "Open Work view").tap();
  await item(screen, "F").first().tap();
  await expect(navigator.getByRole("button", "sub")).toBeVisible();

  await navigator.getByRole("button", "New file").tap();
  await screen.getByLabel("Name").fill("notes.md");
  await screen.getByRole("button", "Create file").tap();
  await expect(pane.getByRole("tab", "notes.md")).toBeVisible();
  await expect(navigator.getByRole("button", "notes.md")).toBeVisible();
  expect(await repository.git("status", "--porcelain")).toContain("notes.md");

  await navigator.getByRole("button", "New folder").tap();
  await screen.getByLabel("Name").fill("docs");
  await screen.getByRole("button", "Create folder").tap();
  await expect(navigator.getByRole("button", "docs")).toBeVisible();

  await navigator.getByRole("button", "New file").tap();
  await screen.getByLabel("Name").fill("notes.md");
  await screen.getByRole("button", "Create file").tap();
  await expect(screen.getByText("Something with that name already exists.")).toBeVisible();
  await expect(screen.getByLabel("Name")).toBeVisible();
  await screen.getByRole("button", "Cancel").tap();
  await expect(screen.getByLabel("Name")).toHaveCount(0);
});

test("deleting asks before it goes, says it cannot be undone and lists what goes, and Delete removes it from disk and the tree", { tags: ["WORK-053"], platforms: ["web"] }, async ({ screen, hui }) => {
  const repository = await hui.repository();
  await writeFile(join(repository.path, "gone.txt"), "bye\n");
  await mkdir(join(repository.path, "docs"));
  await writeFile(join(repository.path, "docs", "inner.txt"), "inner\n");
  const session = await hui.createSession({ title: "Delete files", cwd: repository.path });
  const navigator = screen.getByLabel("Files navigator");

  await hui.wideScreen();
  await hui.open(`/sessions/${session.id}`);
  await screen.getByRole("button", "Show Work pane").tap();
  await screen.getByRole("button", "Open Work view").tap();
  await item(screen, "F").first().tap();
  await expect(navigator.getByRole("button", "gone.txt")).toBeVisible();

  await navigator.getByRole("button", "Delete gone.txt").tap();
  await expect(screen.getByText("Delete gone.txt?")).toBeVisible();
  await expect(screen.getByText("Deleting does not use the trash and cannot be undone. It removes:")).toBeVisible();
  await expect(screen.getByText("gone.txt", { exact: false }).first()).toBeVisible();
  await screen.getByRole("button", "Cancel").tap();
  await expect(navigator.getByRole("button", "gone.txt")).toBeVisible();
  expect(await repository.git("status", "--porcelain")).toContain("gone.txt");

  await navigator.getByRole("button", "Delete gone.txt").tap();
  await screen.getByRole("button", "Delete").tap();
  await expect(navigator.getByRole("button", "gone.txt")).toHaveCount(0);
  expect(await repository.git("status", "--porcelain")).not.toContain("gone.txt");

  await navigator.getByRole("button", "Delete docs").tap();
  await expect(screen.getByText("Delete docs?")).toBeVisible();
  await expect(screen.getByText(/The folder .*docs.* and everything inside it\./u)).toBeVisible();
  await screen.getByRole("button", "Delete").tap();
  await expect(navigator.getByRole("button", "docs")).toHaveCount(0);
  expect(await repository.git("status", "--porcelain")).not.toContain("docs");
});