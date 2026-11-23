/** The Diff view opens on the changes a conversation has: an uncommitted file, else the previous branch (WORK-063). */
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";
import { openWork } from "./work-views.ts";

test("the Diff view lists an uncommitted file, and opens on the previous branch when the tree is clean", { tags: ["WORK-063"], platforms: ["web"] }, async ({ screen, hui }) => {
  const repository = await hui.repository();
  await writeFile(join(repository.path, "change.txt"), "changed\n");
  const session = await hui.createSession({ title: "Diff review", cwd: repository.path });

  await hui.open(`/sessions/${session.id}`);
  await openWork(screen, "Diff");
  await expect(screen.getByText("change.txt", { exact: true })).toBeVisible();

  // Nothing is uncommitted in a fresh checkout, so the view opens on the previous branch instead.
  const clean = await hui.repository();
  const committed = await hui.createSession({ title: "Diff on a clean tree", cwd: clean.path });
  await hui.open(`/sessions/${committed.id}`);
  await openWork(screen, "Diff");
  await expect(screen.getByRole("button", /^Compare:/u)).toHaveAttribute("aria-label", "Compare: Against the previous branch");
  await expect(screen.getByText(/merge base with main/u)).toBeVisible();
});
