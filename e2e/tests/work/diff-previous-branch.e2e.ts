/** Comparing against the previous branch of a stack: the branch it found and how, the searchable picker of ancestors
 * with how far behind each is, and Include uncommitted leaving the working tree out (WORK-065). */
import { appendFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";
import { openWork } from "./work-views.ts";

test("Against the previous branch names the branch it found and how, lists the ancestors first with their distance, and Include uncommitted leaves the working tree out", { tags: ["WORK-065"], platforms: ["web"] }, async ({ screen, hui }) => {
  const repository = await hui.repository();
  const keep = join(repository.path, "sub", "keep.txt");
  // A stack: stack/topic sits on stack/base, and release/1.0 shares only the repository's first commit.
  repository.git("switch", "-q", "-c", "stack/base", "main");
  await appendFile(keep, "base line\n");
  repository.git("commit", "-qam", "base work");
  repository.git("switch", "-q", "-c", "stack/topic");
  await appendFile(keep, "topic line\n");
  repository.git("commit", "-qam", "topic work");
  // More branches than the picker shows without a search field.
  for (const name of ["extra-1", "extra-2", "extra-3", "extra-4", "extra-5"]) repository.git("branch", name, "main");
  const session = await hui.createSession({ title: "Previous branch", cwd: repository.path });

  await hui.open(`/sessions/${session.id}`);
  await openWork(screen, "Diff");
  const compare = screen.getByRole("button", /^Compare:/u);
  const changed = screen.getByLabel("Changed files");

  // The comparison names the branch it found and how it found it.
  await expect(compare).toHaveAttribute("aria-label", "Compare: Against the previous branch");
  await compare.tap();
  const previous = screen.getByRole("listbox", "Compare").getByRole("option").filter({ hasText: "Against the previous branch" });
  expect(await hui.textOf(previous)).toContain("stack/base (nearest ancestor)");
  await compare.tap();

  // The working tree joins the comparison until Include uncommitted is unticked.
  await writeFile(join(repository.path, "sub", "extra.txt"), "extra\n");
  await screen.getByRole("button", "Refresh").tap();
  await expect(changed.getByRole("button").filter({ hasText: "extra.txt" })).toBeVisible();
  const include = screen.getByRole("checkbox", "Include uncommitted");
  await expect(include).toBeChecked();
  await include.uncheck();
  await expect(changed.getByRole("button").filter({ hasText: "extra.txt" })).toHaveCount(0);
  await expect(screen.getByText(/→ stack\/topic$/u)).toBeVisible();
  await include.check();
  await expect(changed.getByRole("button").filter({ hasText: "extra.txt" })).toBeVisible();
  await expect(screen.getByText(/→ stack\/topic \+ working tree/u)).toBeVisible();

  // The picker is searchable and lists the ancestors first, each with how far behind HEAD it is.
  const branchPicker = screen.getByRole("button", /^Previous branch:/u);
  await branchPicker.tap();
  const branches = screen.getByRole("listbox", "Previous branch").getByRole("option");
  const find = screen.getByRole("combobox", "Find a branch");
  await expect(find).toBeVisible();
  const listed = await branches.allTextContents();
  const at = (name: string) => listed.findIndex((text) => text.startsWith(name));
  expect(at("stack/base")).toBeGreaterThanOrEqual(0);
  expect(at("main")).toBeGreaterThan(at("stack/base"));
  expect(at("release/1.0")).toBeGreaterThan(at("main"));
  expect(listed[at("stack/base")]).toContain("HEAD is 1 commit ahead");
  expect(listed[at("main")]).toContain("HEAD is 2 commits ahead");
  expect(listed[at("release/1.0")]).toContain("not an ancestor of HEAD");

  // Typing narrows the list to the branches that match.
  await find.fill("release");
  await expect(branches).toHaveCount(1);
  expect((await branches.allTextContents())[0]).toContain("release/1.0");
  await branchPicker.tap();
});
