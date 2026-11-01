/** What a Diff view compares: the Compare menu's Last commit and default branch (WORK-064), the previous branch it
 * detects and its branch picker (WORK-065), binary, large and line-ending changes (WORK-067), the narrow pane
 * (WORK-071), what each view remembers (WORK-072) and why there is no diff (WORK-073). The pickers are driven with the
 * keys they answer, because their options are only roles the pane's shared tests may not use. */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type Locator, type Screen } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";

/** One changed file's row in a Diff view's list. */
const row = (list: Locator, name: string) => list.getByRole("button").filter({ hasText: name });

/** Opens a picker through its trigger and answers with the list it shows. */
const openPicker = async (screen: Screen, trigger: RegExp, list: string) => {
  await screen.getByLabel(trigger).tap();
  return screen.getByLabel(list, { exact: true });
};

/** Picks the option the picker's keyboard lands on after this many ArrowDowns. */
const chooseByKeys = async (hui: Hui, presses: number) => {
  for (let press = 0; press < presses; press += 1) {
    await hui.keyboard.down("ArrowDown");
    await hui.keyboard.up("ArrowDown");
  }
  await hui.keyboard.down("Enter");
  await hui.keyboard.up("Enter");
};

test("the Compare menu offers Last commit and the default branch, whose comparison starts at the merge base and names both sides", { tags: ["WORK-064"], platforms: ["web"] }, async ({ screen, hui }) => {
  const repository = await hui.repository();
  await writeFile(join(repository.path, "work.txt"), "uncommitted work\n");
  repository.git("switch", "main");
  await writeFile(join(repository.path, "main-only.txt"), "on main\n");
  repository.git("add", "main-only.txt");
  repository.git("commit", "-m", "a commit that reached main later");
  repository.git("switch", "feature/current");
  const [sha = "", subject = ""] = repository.git("log", "-1", "--format=%h%x00%s", "HEAD").split("\0");
  const session = await hui.createSession({ title: "Compare diffs", cwd: repository.path });
  const changed = screen.getByLabel("Changed files");

  await hui.open(`/sessions/${session.id}`);
  await hui.openWorkView("Diff");
  await expect(screen.getByLabel("Compare: Uncommitted changes")).toBeVisible();
  await expect(row(changed, "work.txt")).toHaveCount(1);

  const menu = await openPicker(screen, /^Compare:/u, "Compare");
  await expect(menu).toBeVisible();
  const listed = await hui.textOf(menu);
  expect(listed).toContain("Last commit");
  expect(listed).toContain(`${sha} ${subject}`);
  expect(listed).toContain("Against the default branch");
  expect(listed).toContain("main");

  await chooseByKeys(hui, 2);
  await expect(screen.getByLabel("Compare: Against the default branch")).toBeVisible();
  await expect(screen.getByText(/merge base with main/u).first()).toBeVisible();
  await expect(screen.getByText(/→ feature\/current \+ working tree/u).first()).toBeVisible();
  await expect(row(changed, "work.txt")).toHaveCount(1);
  await expect(row(changed, "main-only.txt")).toHaveCount(0);

  await writeFile(join(repository.path, "sub", "note.txt"), "note\n");
  const nested = await hui.createSession({ title: "Compare a subfolder", cwd: join(repository.path, "sub") });
  await hui.open(`/sessions/${nested.id}`);
  await hui.openWorkView("Diff");
  await openPicker(screen, /^Compare:/u, "Compare");
  await chooseByKeys(hui, 2);
  await expect(screen.getByLabel("Compare: Against the default branch")).toBeVisible();
  await expect(screen.getByText("only sub/")).toBeVisible();
});

test("Against the previous branch names the branch it found and how, its picker searches ancestors first, and Include uncommitted leaves the working tree out", { tags: ["WORK-065"], platforms: ["web"] }, async ({ screen, hui }) => {
  const repository = await hui.repository();
  for (let index = 1; index <= 8; index += 1) repository.git("branch", `spare-${index}`, "release/1.0");
  await writeFile(join(repository.path, "mine.txt"), "mine\n");
  const session = await hui.createSession({ title: "Compare with a branch", cwd: repository.path });
  const changed = screen.getByLabel("Changed files");

  await hui.open(`/sessions/${session.id}`);
  await hui.openWorkView("Diff");
  await openPicker(screen, /^Compare:/u, "Compare");
  await chooseByKeys(hui, 2);
  await expect(screen.getByLabel("Compare: Against the previous branch")).toBeVisible();

  const comparison = await openPicker(screen, /^Compare:/u, "Compare");
  await expect(comparison).toBeVisible();
  expect(await hui.textOf(comparison)).toContain("main (nearest ancestor)");
  await hui.keyboard.down("Escape");
  await hui.keyboard.up("Escape");

  const branches = await openPicker(screen, /^Previous branch:/u, "Previous branch");
  await expect(branches).toBeVisible();
  const listed = await hui.textOf(branches);
  expect(listed.startsWith("main")).toBe(true);
  expect(listed.indexOf("main")).toBeLessThan(listed.indexOf("spare-1"));
  expect(listed).toContain("detected · HEAD is 1 commit ahead");
  expect(listed).toContain("release/1.0");
  expect(listed).toContain("not an ancestor of HEAD");

  await screen.getByLabel("Find a branch").fill("spare-3");
  await expect.poll(async () => hui.textOf(branches)).toContain("spare-3");
  expect(await hui.textOf(branches)).not.toContain("spare-1");
  await hui.keyboard.down("Escape");
  await hui.keyboard.up("Escape");

  await expect(row(changed, "mine.txt")).toHaveCount(1);
  const include = screen.getByLabel("Include uncommitted");
  await expect(include).toBeChecked();
  await include.tap();
  await expect(include).not.toBeChecked();
  await expect(row(changed, "mine.txt")).toHaveCount(0);
});

test("a binary file, a patch over 1,500 lines, a missing final newline and mixed CRLF endings are each marked", { tags: ["WORK-067"], platforms: ["web"] }, async ({ screen, hui }) => {
  const repository = await hui.repository();
  const oldLines = Array.from({ length: 800 }, (_, index) => `old line ${index + 1}`).join("\n");
  const newLines = Array.from({ length: 800 }, (_, index) => `new line ${index + 1}`).join("\n");
  await writeFile(join(repository.path, "blob.bin"), Buffer.from([0, 1, 2, 3, 0, 255]));
  await writeFile(join(repository.path, "big.txt"), `${oldLines}\n`);
  await writeFile(join(repository.path, "tail.txt"), "no newline here");
  await writeFile(join(repository.path, "eol.txt"), "one\ntwo\nthree\nfour\nfive\nsix\n");
  repository.git("add", "blob.bin", "big.txt", "tail.txt", "eol.txt");
  repository.git("commit", "-m", "files to compare");
  await writeFile(join(repository.path, "blob.bin"), Buffer.from([0, 9, 9, 9, 0, 255, 7]));
  await writeFile(join(repository.path, "big.txt"), `${newLines}\n`);
  await writeFile(join(repository.path, "tail.txt"), "no newline here\nbut changed");
  await writeFile(join(repository.path, "eol.txt"), "one\r\ntwo\r\nthree\nfour\nFIVE\nsix\n");
  const session = await hui.createSession({ title: "Read marked changes", cwd: repository.path });
  const changed = screen.getByLabel("Changed files");

  await hui.wideScreen();
  await hui.open(`/sessions/${session.id}`);
  await hui.openWorkView("Diff");
  await screen.getByRole("button", "Maximize Work pane").tap();

  await row(changed, "blob.bin").tap();
  const blob = screen.getByLabel("Changes in blob.bin");
  await expect(blob.getByText("Binary file")).toBeVisible();

  await row(changed, "big.txt").tap();
  const big = screen.getByLabel("Changes in big.txt");
  await expect(big.getByText("Large diff")).toBeVisible();
  await big.getByRole("button", "Show diff").tap();
  await expect(big.getByText("Large diff")).toHaveCount(0);
  expect(await hui.textOf(big)).toContain("new line 1");

  await row(changed, "tail.txt").tap();
  await expect(screen.getByLabel("Changes in tail.txt").getByText("No newline at end of file").first()).toBeVisible();

  await row(changed, "eol.txt").tap();
  const eol = screen.getByLabel("Changes in eol.txt");
  await expect(eol.getByLabel("CRLF").first()).toBeVisible();
  expect(await eol.getByLabel("CRLF").count()).toBeGreaterThan(1);
});

test("below 640px the changed files fill the view, a file shows its diff with its path, and Back returns to the list", { tags: ["WORK-071"], platforms: ["web"] }, async ({ screen, hui }) => {
  const repository = await hui.repository();
  await writeFile(join(repository.path, "alpha.txt"), "alpha\n");
  await writeFile(join(repository.path, "sub", "beta.txt"), "beta\n");
  const session = await hui.createSession({ title: "Diff on a narrow pane", cwd: repository.path });
  const changed = screen.getByLabel("Changed files");

  await hui.open(`/sessions/${session.id}`);
  await hui.openWorkView("Diff");
  const resizer = screen.getByLabel("Resize Work pane");
  await resizer.tap();
  await expect(resizer).toBeFocused();
  await hui.keyboard.down("Home");
  await hui.keyboard.up("Home");
  await expect.poll(async () => Number(await resizer.getAttribute("aria-valuenow"))).toBe(320);

  await expect(changed).toBeVisible();
  await expect(screen.getByLabel("Changes", { exact: true })).toHaveCount(0);
  await expect(row(changed, "alpha.txt")).toHaveCount(1);

  await row(changed, "alpha.txt").tap();
  const main = screen.getByLabel("Changes in alpha.txt");
  await expect(main).toBeVisible();
  await expect(changed).toBeHidden();

  await main.getByLabel("Back to changed files").tap();
  await expect(changed).toBeVisible();
  await expect(screen.getByLabel(/^Changes in /u)).toHaveCount(0);
});

test("each Diff view keeps its comparison, branch, Include uncommitted, layout and file across a reload, several can be open, and closing one forgets them", { tags: ["WORK-072"], platforms: ["web"] }, async ({ screen, hui }) => {
  const repository = await hui.repository();
  await writeFile(join(repository.path, "alpha.txt"), "alpha\n");
  await writeFile(join(repository.path, "sub", "beta.txt"), "beta\n");
  await writeFile(join(repository.path, "mine.txt"), "mine\n");
  repository.git("add", "mine.txt");
  repository.git("commit", "-m", "a change on this branch");
  repository.git("switch", "-c", "topic", "main");
  await writeFile(join(repository.path, "topic.txt"), "topic\n");
  repository.git("add", "topic.txt");
  repository.git("commit", "-m", "topic work");
  repository.git("switch", "feature/current");
  const session = await hui.createSession({ title: "Keep diff choices", cwd: repository.path });
  const pane = screen.getByLabel("Work pane");
  const changed = screen.getByLabel("Changed files");

  await hui.open(`/sessions/${session.id}`);
  await hui.openWorkView("Diff");
  await screen.getByRole("button", "Maximize Work pane").tap();

  await openPicker(screen, /^Compare:/u, "Compare");
  await chooseByKeys(hui, 2);
  await expect(screen.getByLabel("Compare: Against the previous branch")).toBeVisible();
  await screen.getByLabel(/^Previous branch:/u).tap();
  await screen.getByText("topic", { exact: true }).tap();
  await expect(screen.getByLabel("Previous branch: topic")).toBeVisible();
  const include = screen.getByLabel("Include uncommitted");
  await include.tap();
  await expect(include).not.toBeChecked();
  await screen.getByRole("button", "Side by side").tap();
  await expect(screen.getByRole("button", "Side by side")).toHaveAttribute("aria-pressed", "true");
  await expect(row(changed, "alpha.txt")).toHaveCount(0);
  await row(changed, "mine.txt").tap();
  await expect(screen.getByLabel("Changes in mine.txt")).toBeVisible();

  await hui.reload();
  await expect(screen.getByLabel("Compare: Against the previous branch")).toBeVisible();
  await expect(screen.getByLabel("Previous branch: topic")).toBeVisible();
  await expect(screen.getByLabel("Include uncommitted")).not.toBeChecked();
  await expect(screen.getByRole("button", "Side by side")).toHaveAttribute("aria-pressed", "true");
  await expect(screen.getByLabel("Changes in mine.txt")).toBeVisible();

  await hui.workChord("D");
  await expect(pane.getByRole("tab", "Diff")).toHaveCount(2);
  await expect(screen.getByLabel("Compare: Uncommitted changes")).toHaveCount(1);
  await expect(screen.getByLabel("Compare: Against the previous branch")).toHaveCount(1);

  await pane.getByRole("button", "Close Diff").first().tap();
  await expect(pane.getByRole("tab", "Diff")).toHaveCount(1);
  await hui.workChord("D");
  await expect(pane.getByRole("tab", "Diff")).toHaveCount(2);
  await expect(screen.getByLabel("Compare: Uncommitted changes")).toHaveCount(2);
});

test("a folder outside Git says Not a Git repository and a missing folder says Diffs are not available, each with its reason and Check again", { tags: ["WORK-073"], platforms: ["web"] }, async ({ screen, hui }) => {
  const outside = await mkdtemp(join(tmpdir(), "hui-e2e-plain-"));
  const missing = await mkdtemp(join(tmpdir(), "hui-e2e-gone-"));
  const plain = await hui.createSession({ title: "Diff outside Git", cwd: outside });
  const gone = await hui.createSession({ title: "Diff of a missing folder", cwd: missing });

  await hui.open(`/sessions/${plain.id}`);
  await hui.openWorkView("Diff");
  await expect(screen.getByText("Not a Git repository")).toBeVisible();
  await expect(screen.getByText("The conversation's working directory is not inside a Git repository.")).toBeVisible();
  await expect(screen.getByRole("button", "Check again")).toBeVisible();

  await rm(missing, { recursive: true, force: true });
  await hui.open(`/sessions/${gone.id}`);
  await hui.openWorkView("Diff");
  await expect(screen.getByText("Diffs are not available")).toBeVisible();
  await expect(screen.getByText("The conversation's working directory no longer exists.")).toBeVisible();
  await expect(screen.getByRole("button", "Check again")).toBeVisible();
  await rm(outside, { recursive: true, force: true });
});
