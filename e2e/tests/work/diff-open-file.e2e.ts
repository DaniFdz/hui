/** A changed file opens in the conversation's Files view from the Diff view, at its first changed line, and a deleted
 * file has nothing to open (WORK-069). The line is the editor's own mark, read off the element that holds its text. */
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";
import { openWork } from "./work-views.ts";

test("the diff's file name and its Open in Files button both open the file at its first changed line, and a deleted file says there is nothing to open", { tags: ["WORK-069"], platforms: ["web"] }, async ({ screen, hui }) => {
  const repository = await hui.repository();
  const lines = Array.from({ length: 20 }, (_, index) => `line ${index + 1}`);
  await writeFile(join(repository.path, "notes.txt"), `${lines.join("\n")}\n`);
  await writeFile(join(repository.path, "gone.txt"), "removed before the turn\n");
  repository.git("add", "-A");
  repository.git("commit", "-m", "notes");
  // Two lines change, so the first changed line is neither the first nor the last line of the file.
  await writeFile(join(repository.path, "notes.txt"), `${lines.map((line, index) => (index === 7 || index === 11 ? `${line} changed` : line)).join("\n")}\n`);
  await rm(join(repository.path, "gone.txt"));
  const session = await hui.createSession({ title: "Open a changed file", cwd: repository.path });
  const pane = screen.getByLabel("Work pane");

  await hui.wideScreen();
  await hui.open(`/sessions/${session.id}`);
  await openWork(screen, "Diff");
  // Maximized, the pane keeps the changed-file list beside the diff: the file's header stays reachable while its diff is
  // shown, which is the two-column Diff view rather than the narrow one's detail.
  await screen.getByRole("button", "Maximize Work pane").tap();
  await expect(screen.getByRole("button", "Back to changed files")).toHaveCount(0);
  const changed = screen.getByLabel("Changed files");
  await changed.getByRole("button").filter({ hasText: "notes.txt" }).tap();
  const main = screen.getByLabel(/^Changes in /u);
  /** The class CodeMirror puts on the line a reveal landed on, read off the one element holding that line's text. */
  const marked = async (line: string) => (await screen.getByLabel("Contents of notes.txt").getByText(line, { exact: true }).getAttribute("class")) ?? "";

  // The file's name in the diff header opens the Files view on it, at the first line the diff added.
  await main.getByRole("button", "notes.txt").tap();
  await expect(pane.getByRole("tab", "notes.txt")).toHaveAttribute("aria-selected", "true");
  await expect.poll(() => marked("line 8 changed")).toContain("cm-hui-target-line");
  expect(await screen.getByLabel("Contents of notes.txt").getByText("line 12 changed", { exact: true }).getAttribute("class")).toBe("cm-line");

  // The header's own Open in Files control shows the same file the same way, without adding a second Files tab. Opening
  // the file shows its Files tab, so the test goes back to the Diff tab to reach that header again.
  await pane.getByRole("tab", "Diff").tap();
  await main.getByRole("button", "Open notes.txt in Files").tap();
  await expect(pane.getByRole("tab", "notes.txt")).toHaveAttribute("aria-selected", "true");
  await expect(pane.getByRole("tab")).toHaveCount(2);
  await expect.poll(() => marked("line 8 changed")).toContain("cm-hui-target-line");

  // A deleted file has no text to show in Files, and the header says so instead of offering to open it. The Files tab
  // is in front again, so the changed files are reached from the Diff tab.
  await pane.getByRole("tab", "Diff").tap();
  await changed.getByRole("button").filter({ hasText: "gone.txt" }).tap();
  const gone = screen.getByLabel(/^Changes in /u);
  await expect(gone.getByText("deleted: nothing to open")).toBeVisible();
  await expect(gone.getByRole("button", /^Open .* in Files$/u)).toHaveCount(0);
  await expect(pane.getByRole("tab")).toHaveCount(2);
});
