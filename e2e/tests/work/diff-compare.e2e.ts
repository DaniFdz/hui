/** The Diff view's Compare menu: Last commit with its sha and subject, and the default branch from the merge base, so
 * a commit that reached main later stays out of the comparison (WORK-064). */
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";
import { openWork } from "./work-views.ts";

test("Compare offers Last commit with its sha and subject and the default branch from the merge base, whose line names both sides and the subfolder", { tags: ["WORK-064"], platforms: ["web"] }, async ({ screen, hui }) => {
  const repository = await hui.repository();
  const keep = join(repository.path, "sub", "keep.txt");
  await writeFile(keep, "sub\nfeature line\n");
  repository.git("commit", "-qam", "feature work");
  const feature = repository.git("rev-parse", "HEAD");
  // A later commit on main touches the same file, and must not join the comparison against main.
  repository.git("switch", "-q", "main");
  await writeFile(keep, "sub\nmain later\n");
  repository.git("commit", "-qam", "later on main");
  repository.git("switch", "-q", "feature/current");
  const base = repository.git("merge-base", "HEAD", "main");
  const session = await hui.createSession({ title: "Compare", cwd: join(repository.path, "sub") });

  await hui.open(`/sessions/${session.id}`);
  await openWork(screen, "Diff");
  const compare = screen.getByRole("button", /^Compare:/u);
  await compare.tap();

  // The menu names each comparison, and Last commit carries its sha and subject.
  const options = screen.getByRole("listbox", "Compare").getByRole("option");
  const lastCommit = options.filter({ hasText: "Last commit" });
  await expect(lastCommit).toBeVisible();
  const last = await hui.textOf(lastCommit);
  expect(last).toContain(feature.slice(0, 7));
  expect(last).toContain("feature work");
  const defaultBranch = options.filter({ hasText: "Against the default branch" });
  expect(await hui.textOf(defaultBranch)).toContain("main");

  await defaultBranch.tap();
  await expect(compare).toHaveAttribute("aria-label", "Compare: Against the default branch");

  // The line under the header names both sides, from the merge base, and the subfolder it shows.
  const summary = screen.getByText(/merge base with main/u);
  const line = await hui.textOf(summary);
  expect(line).toContain(base.slice(0, 7));
  expect(line).toContain("→ feature/current");
  await expect(screen.getByText("only sub/")).toBeVisible();

  const changed = screen.getByLabel("Changed files");
  const file = changed.getByRole("button").filter({ hasText: "keep.txt" });
  await expect(file).toBeVisible();
  await file.tap();
  const diff = await hui.textOf(screen.getByLabel(/^Changes in /u));
  expect(diff).toContain("+feature line");
  expect(diff).not.toContain("main later");
});
