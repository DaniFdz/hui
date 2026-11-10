/** Each Diff view keeps its own comparison, Include uncommitted, layout and selected file across a reload, forgets
 * them when its tab closes, and several Diff views stay open with their own choices (WORK-072). */
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, type Locator } from "e2e";
import { test } from "../../fixtures/hui.ts";
import { openWork } from "./work-views.ts";

test("a Diff view keeps its comparison, Include uncommitted, layout and file across a reload, forgets them when its tab closes, and another Diff view keeps its own", { tags: ["WORK-072"], platforms: ["web"] }, async ({ screen, hui }) => {
  const repository = await hui.repository();
  const keep = join(repository.path, "sub", "keep.txt");
  repository.git("switch", "-q", "feature/current");
  await writeFile(keep, "sub\nfeature line\n");
  repository.git("commit", "-qam", "feature work");
  // One uncommitted file, so a fresh Diff view can open on the working tree.
  await writeFile(join(repository.path, "sub", "draft.txt"), "draft\n");
  const session = await hui.createSession({ title: "Diff choices", cwd: repository.path });
  const pane = screen.getByLabel("Work pane");
  const changes = (view: Locator) => view.getByLabel("Changed files");
  const row = (view: Locator, name: string) => changes(view).getByRole("button").filter({ hasText: name });

  await hui.wideScreen();
  await hui.open(`/sessions/${session.id}`);
  await hui.openWorkView("Diff");
  await screen.getByRole("button", "Maximize Work pane").tap();

  // Choose a comparison, leave the working tree out, pick a file and a layout.
  const first = screen.getByRole("tabpanel", "Diff");
  await first.getByRole("button", /^Compare:/u).tap();
  await screen.getByRole("listbox", "Compare").getByRole("option").filter({ hasText: "Against the default branch" }).tap();
  await expect(first.getByRole("button", /^Compare:/u)).toHaveAttribute("aria-label", "Compare: Against the default branch");
  const include = first.getByRole("checkbox", "Include uncommitted");
  await expect(include).toBeChecked();
  await include.tap();
  await expect(include).not.toBeChecked();
  await expect(row(first, "draft.txt")).toHaveCount(0);
  await row(first, "keep.txt").tap();
  await expect(row(first, "keep.txt")).toHaveAttribute("aria-current", "true");
  await first.getByRole("button", "Side by side").tap();
  await expect(first.getByRole("button", "Side by side")).toHaveAttribute("aria-pressed", "true");

  // A reload brings the view back with all four choices, the same file still open.
  await hui.reload();
  const restored = screen.getByRole("tabpanel", "Diff");
  await expect(restored.getByRole("button", /^Compare:/u)).toHaveAttribute("aria-label", "Compare: Against the default branch");
  await expect(restored.getByRole("checkbox", "Include uncommitted")).not.toBeChecked();
  await expect(restored.getByRole("button", "Side by side")).toHaveAttribute("aria-pressed", "true");
  await expect(row(restored, "keep.txt")).toHaveAttribute("aria-current", "true");
  await expect(restored.getByLabel(/^Changes in /u)).toBeVisible();

  // Closing its tab forgets them: the next Diff view opens on the working tree, unified and with nothing picked.
  await pane.getByRole("button", "Close Diff").tap();
  await expect(pane.getByRole("tab")).toHaveCount(0);
  await openWork(screen, "Diff");
  // A wide enough pane keeps the layout switch on screen.
  await screen.getByRole("button", "Maximize Work pane").tap();
  const second = screen.getByRole("tabpanel", "Diff");
  await expect(second.getByRole("button", /^Compare:/u)).toHaveAttribute("aria-label", "Compare: Uncommitted changes");
  await expect(second.getByRole("button", "Unified")).toHaveAttribute("aria-pressed", "true");
  // It selected the working tree's first file, not the one the forgotten view had open.
  await expect(second.getByLabel("Changes in sub/draft.txt")).toBeVisible();

  // A third Diff view keeps its own choice beside it; switching tabs shows each view's own comparison.
  await openWork(screen, "Diff");
  await expect(pane.getByRole("tab", "Diff")).toHaveCount(2);
  const third = screen.getByRole("tabpanel", "Diff");
  await third.getByRole("button", /^Compare:/u).tap();
  await screen.getByRole("listbox", "Compare").getByRole("option").filter({ hasText: "Last commit" }).tap();
  await expect(third.getByRole("button", /^Compare:/u)).toHaveAttribute("aria-label", "Compare: Last commit");

  await pane.getByRole("tab", "Diff").first().tap();
  await expect(screen.getByRole("tabpanel", "Diff").getByRole("button", /^Compare:/u)).toHaveAttribute("aria-label", "Compare: Uncommitted changes");
  await pane.getByRole("tab", "Diff").last().tap();
  await expect(screen.getByRole("tabpanel", "Diff").getByRole("button", /^Compare:/u)).toHaveAttribute("aria-label", "Compare: Last commit");
});
