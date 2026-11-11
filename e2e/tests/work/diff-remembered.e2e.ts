/** Each Diff view keeps its own comparison and selected file across a reload, several Diff views are open at once, and
 * closing a tab forgets its choices (WORK-072). */
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";
import { openWork, resumeWork } from "./work-views.ts";

test("each Diff view keeps its comparison and selected file across a reload, several open at once, and a closed tab's choices are forgotten", { tags: ["WORK-072"], platforms: ["web"] }, async ({ screen, hui }) => {
  const repository = await hui.repository();
  const keep = join(repository.path, "sub", "keep.txt");
  // One file changed in the working tree, two changed by the commit that is now the last one.
  await writeFile(keep, "sub\nnot committed yet\n");
  await writeFile(join(repository.path, "sub", "last.txt"), "sub\nin the last commit\n");
  await writeFile(join(repository.path, "sub", "second.txt"), "sub\nsecond in the last commit\n");
  repository.git("add", "sub/last.txt", "sub/second.txt");
  repository.git("commit", "-q", "-m", "last change");
  const session = await hui.createSession({ title: "Remembered diffs", cwd: repository.path });
  const pane = screen.getByLabel("Work pane");
  const changed = screen.getByLabel("Changed files");
  const compare = () => screen.getByRole("button", /^Compare:/u);
  const shown = (path: string) => screen.getByLabel(new RegExp(`^Changes in .*${path}$`, "u"));
  const row = (name: string) => changed.getByRole("button").filter({ hasText: name });

  await hui.open(`/sessions/${session.id}`);
  await openWork(screen, "Diff");
  await expect(compare()).toHaveAttribute("aria-label", "Compare: Uncommitted changes");
  await expect(changed.getByRole("button").filter({ hasText: "keep.txt" })).toBeVisible();

  // The first view compares against the last commit and shows that commit's second file.
  await compare().tap();
  await screen.getByRole("listbox", "Compare").getByRole("option").filter({ hasText: "Last commit" }).tap();
  await expect(compare()).toHaveAttribute("aria-label", "Compare: Last commit");
  await expect(changed.getByRole("button").filter({ hasText: "last.txt" })).toBeVisible();
  await changed.getByRole("button").filter({ hasText: "second.txt" }).tap();
  await expect(shown("second\\.txt")).toBeVisible();

  // A second Diff view is a view of its own, on the uncommitted changes.
  await openWork(screen, "Diff");
  await expect(pane.getByRole("tab", "Diff")).toHaveCount(2);
  await expect(compare()).toHaveAttribute("aria-label", "Compare: Uncommitted changes");
  await expect(row("keep.txt")).toBeVisible();
  await expect(row("second.txt")).toHaveCount(0);

  // A reload brings each view back with its own comparison and the file it had picked.
  await hui.reload();
  // A phone lands on the chat and reaches the pane's views from the Active panel selector again.
  await resumeWork(hui, screen, "Diff");
  await expect(pane.getByRole("tab", "Diff").first()).toBeVisible();
  await pane.getByRole("tab", "Diff").first().tap();
  await expect(compare()).toHaveAttribute("aria-label", "Compare: Last commit");
  await expect(row("second.txt")).toHaveAttribute("aria-current", "true");
  await expect(row("last.txt")).toHaveAttribute("aria-current", "false");
  await pane.getByRole("tab", "Diff").last().tap();
  await expect(compare()).toHaveAttribute("aria-label", "Compare: Uncommitted changes");
  await expect(row("keep.txt")).toBeVisible();
  await expect(row("second.txt")).toHaveCount(0);

  // Closing a view forgets its choices: a Diff opened after it starts from the defaults.
  await pane.getByRole("button", "Close Diff").first().tap();
  await expect(pane.getByRole("tab", "Diff")).toHaveCount(1);
  await openWork(screen, "Diff");
  await expect(pane.getByRole("tab", "Diff")).toHaveCount(2);
  await expect(compare()).toHaveAttribute("aria-label", "Compare: Uncommitted changes");
  await expect(row("keep.txt")).toBeVisible();
  await expect(row("second.txt")).toHaveCount(0);
});
