/** A file's unsaved text is the page's, not one view's: every Files view showing that file draws it, it outlives the tab
 * it was typed in and a reload, and it reaches the disk once the save it was waiting on can run. A closed Files tab's
 * selection and open folders are its own and go with it (WORK-046). The draft stays unsaved because the gateway refuses
 * the save, which is what keeps the text in front of a reload rather than in the file. Two Files views are open at once,
 * so every read names the view it means: only the one in front is a panel of the Work pane that is not inert. */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";
import { openWork, resumeWork } from "./work-views.ts";

test("unsaved text shows in every Files view of its file and survives closing the tab and a reload, and a closed tab's selection goes with it", { tags: ["WORK-046"], platforms: ["web"] }, async ({ screen, hui }) => {
  const repository = await hui.repository();
  const keep = join(repository.path, "sub", "keep.txt");
  await writeFile(keep, "keep");
  const session = await hui.createSession({ title: "Keep unsaved text", cwd: repository.path });
  const pane = screen.getByLabel("Work pane");
  const view = (title: string) => screen.getByRole("tabpanel", title);
  const navigator = (title: string) => view(title).getByLabel("Files navigator");
  const editor = () => view("keep.txt").getByLabel(/Contents of .*keep\.txt/u);
  /** Adds a Files view from the launcher and answers the panel it shows under its own empty name. */
  const addView = async () => {
    await screen.getByRole("button", "Open Work view").tap();
    await screen.getByRole("menuitem").filter({ hasText: "Files" }).tap();
    await expect(view("Files")).toBeVisible();
  };

  await hui.open(`/sessions/${session.id}`);
  await openWork(screen, "Files");
  await navigator("Files").getByRole("button", "sub").tap();
  await navigator("Files").getByRole("button", "keep.txt").tap();
  await expect(editor()).toHaveText("keep");

  // The save is refused, so the typed text is the page's unsaved draft and the file stays as it was.
  const refused = await hui.intercept("PUT", /\/files\/file\?/u);
  await editor().tap();
  await hui.keyboard.down("Control");
  await hui.keyboard.down("End");
  await hui.keyboard.up("End");
  await hui.keyboard.up("Control");
  await hui.type(" and more");
  await refused.arrived();
  await refused.reject(500, "The disk is full.");
  await expect(screen.getByText("Not saved: The disk is full.")).toBeVisible();
  await expect(editor()).toHaveText("keep and more");
  expect(await readFile(keep, "utf8")).toBe("keep");

  // A second Files view of the same file draws that same unsaved text, and so does the first one again.
  await addView();
  await navigator("Files").getByRole("button", "sub").tap();
  await navigator("Files").getByRole("button", "keep.txt").tap();
  await expect(editor()).toHaveText("keep and more");
  await pane.getByRole("tab", "keep.txt").first().tap();
  await expect(editor()).toHaveText("keep and more");

  // Closing the tab the text was typed in keeps it: the view that is left still holds the unsaved text.
  await pane.getByRole("button", "Close keep.txt").last().tap();
  await expect(pane.getByRole("tab", "keep.txt")).toHaveCount(1);
  await expect(editor()).toHaveText("keep and more");

  // A new Files view starts from nothing: the closed one's selection and its open folder are not carried over.
  await addView();
  await expect(navigator("Files").getByRole("button", "sub")).toHaveAttribute("aria-expanded", "false");
  await expect(navigator("Files").getByRole("button", "keep.txt")).toHaveCount(0);

  // The reloaded page restores the unsaved text from the page's own copy, and the save it was waiting on then runs.
  await hui.reload();
  await expect.poll(() => readFile(keep, "utf8")).toBe("keep and more");
  // A phone lands on the chat and reaches the pane's views from the Active panel selector again.
  await resumeWork(hui, screen, "keep.txt");
  await pane.getByRole("tab", "keep.txt").tap();
  await expect(editor()).toHaveText("keep and more");
});
