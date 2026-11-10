/** A file that changes on disk under unsaved typing: the header reads Conflict with the banner that says nothing is
 * saved until a choice, Show the version on disk shows the disk's text, Reload from disk drops the typing and
 * Overwrite with mine writes it, and both choices end on Saved (WORK-045). */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";
import { openWork, showFiles } from "./work-views.ts";

test("a file changed on disk under unsaved typing reads Conflict until Reload from disk or Overwrite with mine", { tags: ["WORK-045"], platforms: ["web"] }, async ({ screen, hui }) => {
  const repository = await hui.repository();
  const report = join(repository.path, "report.txt");
  await writeFile(report, "one\ntwo\n");
  const session = await hui.createSession({ title: "Resolve a conflict", cwd: repository.path });
  const editor = screen.getByLabel(/Contents of .*report\.txt/u);
  const banner = screen.getByRole("alert").filter({ hasText: "This file changed on disk" });
  const status = (text: string) => screen.getByRole("status").filter({ hasText: text });

  await hui.open(`/sessions/${session.id}`);
  await openWork(screen, "Files");
  await showFiles(screen);
  await screen.getByRole("button", "report.txt").tap();
  await expect(editor).toHaveText(/one\s+two/u);
  await expect(status("Saved")).toBeVisible();

  // The file moves on under the open editor, and the typing the page keeps is what meets the newer disk version.
  await writeFile(report, "one\ntwo\nthree\n");
  await editor.tap();
  await hui.keyboard.down("Control");
  await hui.keyboard.down("End");
  await hui.keyboard.up("End");
  await hui.keyboard.up("Control");
  await hui.type("mine");
  await expect(status("Conflict")).toBeVisible();
  await expect(banner).toBeVisible();
  await expect(screen.getByText("Your edits are kept here and nothing is saved until you choose.")).toBeVisible();
  await expect(editor).toHaveText(/one\s+two\s+mine/u);

  // Nothing reached the disk, and the banner can show what did.
  expect(await readFile(report, "utf8")).toBe("one\ntwo\nthree\n");
  await screen.getByText("Show the version on disk").tap();
  await expect.poll(() => hui.textOf(banner)).toMatch(/Show the version on disk\s+one\s+two\s+three/u);

  // Overwrite with mine writes the typed text and ends the conflict.
  await screen.getByRole("button", "Overwrite with mine").tap();
  await expect(status("Saved")).toBeVisible();
  await expect(banner).toHaveCount(0);
  await expect.poll(() => readFile(report, "utf8")).toBe("one\ntwo\nmine");

  // A second change on disk, then Reload from disk: the typing goes and the disk's text shows.
  await writeFile(report, "the disk's version\n");
  await editor.tap();
  await hui.keyboard.down("Control");
  await hui.keyboard.down("End");
  await hui.keyboard.up("End");
  await hui.keyboard.up("Control");
  await hui.type(" again");
  await expect(status("Conflict")).toBeVisible();
  await expect(editor).toHaveText(/one\s+two\s+mine\s+again/u);
  await screen.getByRole("button", "Reload from disk").tap();
  await expect(status("Saved")).toBeVisible();
  await expect(banner).toHaveCount(0);
  await expect(editor).toHaveText("the disk's version");
  expect(await readFile(report, "utf8")).toBe("the disk's version\n");
});
