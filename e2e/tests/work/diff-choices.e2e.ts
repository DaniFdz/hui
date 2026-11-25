/** Each Diff view keeps its own comparison, Include uncommitted, layout and selected file across a reload, forgets
 * them when its tab closes, and several Diff views stay open with their own choices (WORK-072). */
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, type Locator } from "e2e";
import { test } from "../../fixtures/hui.ts";
import { maximizeWork, openWork, reopenWork } from "./work-views.ts";

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
  /** The file the view has open, shown as whichever of the two the width draws: its own header, or the list with its row
   *  marked current — a phone's stacked view draws the list or the file, never both. */
  const openFile = async (view: Locator, path: string): Promise<boolean> => {
    if ((await view.getByLabel(`Changes in ${path}`).count()) > 0) return true;
    const marked = row(view, path.split("/").at(-1)!);
    return (await marked.count()) > 0 && (await marked.getAttribute("aria-current")) === "true";
  };

  await hui.open(`/sessions/${session.id}`);
  // The split workspace gives the pane its widest form so the layout switch is on offer; a phone's destination already
  // is the whole screen, and its Diff view says why side by side is off.
  await openWork(screen, "Diff");
  await maximizeWork(screen);

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
  // The file it opened.
  await expect.poll(() => openFile(first, "sub/keep.txt")).toBe(true);
  // The layout switch is offered only where the view has room for two columns: the stacked view a phone draws has one
  // layout and hides the switch, which a role query then does not match. Where it is drawn, the choice has to come back
  // after the reload.
  const layoutSwitch = first.getByRole("button", "Side by side");
  const split = (await layoutSwitch.count()) > 0;
  if (split) await layoutSwitch.tap();
  if (split) await expect(layoutSwitch).toHaveAttribute("aria-pressed", "true");

  // A reload brings the view back with all four choices, the same file still open. A phone leaves the pane on the chat
  // and keeps the view in its Active panel selector, so the test opens it again there.
  await hui.reload();
  await reopenWork(screen, "Diff");
  const restored = screen.getByRole("tabpanel", "Diff");
  await expect(restored.getByRole("button", /^Compare:/u)).toHaveAttribute("aria-label", "Compare: Against the default branch");
  await expect(restored.getByRole("checkbox", "Include uncommitted")).not.toBeChecked();
  if (split) await expect(restored.getByRole("button", "Side by side")).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => openFile(restored, "sub/keep.txt")).toBe(true);

  // Closing its tab forgets them: the next Diff view opens on the working tree, with its one layout and nothing picked.
  await pane.getByRole("button", "Close Diff").tap();
  await expect(pane.getByRole("tab")).toHaveCount(0);
  await openWork(screen, "Diff");
  await maximizeWork(screen);
  const second = screen.getByRole("tabpanel", "Diff");
  await expect(second.getByRole("button", /^Compare:/u)).toHaveAttribute("aria-label", "Compare: Uncommitted changes");
  if (split) await expect(second.getByRole("button", "Unified")).toHaveAttribute("aria-pressed", "true");
  // It selected the working tree's first file, not the one the forgotten view had open.
  await expect.poll(() => openFile(second, "sub/draft.txt")).toBe(true);

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
