/** The Diff view compares against the last commit (WORK-064). */
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("the Diff view compares against the last commit", { tags: ["WORK-064"], platforms: ["web"] }, async ({ screen, hui }) => {
  const repository = await hui.repository();
  await writeFile(join(repository.path, "base.txt"), "base\n");
  repository.git("add", ".");
  repository.git("commit", "-m", "Initial commit");
  await writeFile(join(repository.path, "base.txt"), "base changed\n");
  const session = await hui.createSession({ title: "Compare", cwd: repository.path });
  const diff = new RegExp("(?:⌥⇧⌘|Ctrl\\+Alt\\+Shift\\+|Alt\\+Shift\\+Ctrl\\+)D", "u");

  await hui.wideScreen();
  await hui.open(`/sessions/${session.id}`);
  await screen.getByRole("button", "Show Work pane").tap();
  await screen.getByRole("button", "Open Work view").tap();
  await screen.getByText(diff).first().tap();
  await screen.getByRole("button", /^Compare: Uncommitted changes/u).tap();
  await screen.getByText("Last commit", { exact: true }).tap();
  await expect(screen.getByRole("button", /^Compare: Last commit/u)).toBeVisible();
  await expect(screen.getByText("base.txt", { exact: true }).first()).toBeVisible();
});
