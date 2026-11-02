/** Each conversation's Diff view keeps its own comparison across switches (WORK-072). */
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("each conversation's Diff view keeps its own comparison", { tags: ["WORK-072"], platforms: ["web"] }, async ({ screen, hui }) => {
  const repository = await hui.repository();
  await writeFile(join(repository.path, "base.txt"), "base\n");
  repository.git("add", ".");
  repository.git("commit", "-m", "Initial commit");
  await writeFile(join(repository.path, "base.txt"), "changed\n");
  const first = await hui.createSession({ title: "First diff", cwd: repository.path });
  const second = await hui.createSession({ title: "Second diff", cwd: repository.path });
  const diff = new RegExp("(?:⌥⇧⌘|Ctrl\\+Alt\\+Shift\\+|Alt\\+Shift\\+Ctrl\\+)D", "u");
  const show = screen.getByRole("button", "Show Work pane");
  const openDiff = async () => {
    if (await show.isVisible()) await show.tap();
    const menu = screen.getByRole("button", "Open Work view");
    if (await menu.isVisible()) {
      await menu.tap();
      await screen.getByText(diff).first().tap();
    }
  };

  await hui.wideScreen();
  await hui.open(`/sessions/${first.id}`);
  await show.tap();
  await screen.getByRole("button", "Open Work view").tap();
  await screen.getByText(diff).first().tap();
  await screen.getByRole("button", /^Compare: Uncommitted changes/u).tap();
  await screen.getByText("Last commit", { exact: true }).tap();
  await expect(screen.getByRole("button", /^Compare: Last commit/u)).toBeVisible();

  await hui.open(`/sessions/${second.id}`);
  await openDiff();
  await expect(screen.getByRole("button", /^Compare: Uncommitted changes/u)).toBeVisible();

  await hui.open(`/sessions/${first.id}`);
  await openDiff();
  await expect(screen.getByRole("button", /^Compare: Last commit/u)).toBeVisible();
});
