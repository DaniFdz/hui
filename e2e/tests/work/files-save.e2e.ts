/** Editing a file in the Work pane's Files view: Saving… then Saved with the typed change on disk and its line endings
 * kept, a failed save that keeps the text and Retry that saves it, and a file HUI cannot write opening Read only
 * (WORK-044). */
import { chmod, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";
import { openWork, showFiles } from "./work-views.ts";

test("typing in the editor saves the typed change to disk, a failed save keeps the text with Retry, and a file HUI cannot write opens Read only", { tags: ["WORK-044"], platforms: ["web"] }, async ({ screen, hui }) => {
  const repository = await hui.repository();
  const notes = join(repository.path, "notes.txt");
  const locked = join(repository.path, "locked.txt");
  await writeFile(notes, "first\r\nsecond\r\n");
  await writeFile(locked, "mine\n");
  await chmod(locked, 0o444);
  const session = await hui.createSession({ title: "Edit a file", cwd: repository.path });
  const editor = screen.getByLabel(/Contents of .*notes\.txt/u);

  await hui.open(`/sessions/${session.id}`);
  await openWork(screen, "Files");
  await showFiles(screen);
  await screen.getByRole("button", "notes.txt").tap();
  await expect(editor).toBeVisible();

  // The line endings of the text already on disk survive the save: only the typed line is new.
  await editor.tap();
  await hui.keyboard.down("Control");
  await hui.keyboard.down("End");
  await hui.keyboard.up("End");
  await hui.keyboard.up("Control");
  await hui.type("third");
  await expect(screen.getByText("Saving…")).toBeVisible();
  await expect(screen.getByText("Saved")).toBeVisible();
  await expect.poll(() => readFile(notes, "utf8")).toBe("first\r\nsecond\r\nthird");

  // A refused save names its reason, keeps the typed text on screen and writes nothing.
  const refused = await hui.intercept("PUT", /\/files\/file\?/u);
  await hui.type(" more");
  await expect(screen.getByText("Saving…")).toBeVisible();
  await refused.arrived();
  await refused.reject(500, "The disk is full.");
  await expect(screen.getByText("Not saved: The disk is full.")).toBeVisible();
  await expect(editor).toHaveText(/first\s+second\s+third more/u);
  await expect.poll(() => readFile(notes, "utf8")).toBe("first\r\nsecond\r\nthird");

  // Retry saves the text the failed request kept.
  await screen.getByRole("button", "Retry").tap();
  await expect(screen.getByText("Saved")).toBeVisible();
  await expect.poll(() => readFile(notes, "utf8")).toBe("first\r\nsecond\r\nthird more");

  await showFiles(screen);
  await screen.getByRole("button", "locked.txt").tap();
  await expect(screen.getByLabel(/Contents of .*locked\.txt/u)).toHaveText(/mine/u);
  await expect(screen.getByText("Read only")).toBeVisible();
});
