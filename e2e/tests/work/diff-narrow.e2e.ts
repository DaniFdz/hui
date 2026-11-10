/** The Diff view on a narrow screen: the changed-file list fills the view, a tap shows that file's diff with its path,
 * and Back to changed files returns to the list (WORK-071). */
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";
import { openWork } from "./work-views.ts";

test("on a narrow screen the changed-file list fills the view, a tap shows the file's diff with its path, and Back to changed files returns to the list", { tags: ["WORK-071"], platforms: ["web"] }, async ({ screen, hui }) => {
  const repository = await hui.repository();
  await writeFile(join(repository.path, "sub", "keep.txt"), "sub\nchanged\n");
  await writeFile(join(repository.path, "sub", "other.txt"), "other\n");
  const session = await hui.createSession({ title: "Narrow diff", cwd: repository.path });
  const changed = screen.getByLabel("Changed files");

  const phone = await hui.phoneScreen();
  await hui.open(`/sessions/${session.id}`);
  await openWork(screen, "Diff");

  // The list is the whole view, and no file's diff is beside it.
  await expect(changed.getByRole("button").filter({ hasText: "keep.txt" })).toBeVisible();
  await expect(changed.getByRole("button").filter({ hasText: "other.txt" })).toBeVisible();
  const box = (await changed.boundingBox())!;
  expect(box.width).toBeGreaterThan(phone.width * 0.9);
  await expect(screen.getByLabel(/^Changes in /u)).toHaveCount(0);

  // A tap shows that file's diff with its path in the header.
  await changed.getByRole("button").filter({ hasText: "keep.txt" }).tap();
  await expect(changed).toBeHidden();
  await expect(screen.getByRole("button", "Back to changed files")).toBeVisible();
  const diff = screen.getByLabel(/^Changes in .*sub\/keep\.txt/u);
  await expect(diff).toBeVisible();
  await expect(diff.getByRole("button", "sub/keep.txt")).toBeVisible();

  // Back returns to the list.
  await screen.getByRole("button", "Back to changed files").tap();
  await expect(changed).toBeVisible();
  await expect(changed.getByRole("button").filter({ hasText: "other.txt" })).toBeVisible();
  await expect(screen.getByLabel(/^Changes in /u)).toHaveCount(0);
});
