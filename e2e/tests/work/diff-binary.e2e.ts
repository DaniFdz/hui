/** A binary change is marked and says it has no text to compare (WORK-067). */
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("a binary change is marked and says it has no text to compare", { tags: ["WORK-067"], platforms: ["web"] }, async ({ screen, hui }) => {
  const repository = await hui.repository();
  await writeFile(join(repository.path, "blob.bin"), Buffer.from([0, 1, 2, 3, 0]));
  repository.git("add", ".");
  repository.git("commit", "-m", "Binary base");
  await writeFile(join(repository.path, "blob.bin"), Buffer.from([0, 9, 9, 9, 0]));
  const session = await hui.createSession({ title: "Binary diff", cwd: repository.path });
  const diff = new RegExp("(?:⌥⇧⌘|Ctrl\\+Alt\\+Shift\\+|Alt\\+Shift\\+Ctrl\\+)D", "u");

  await hui.wideScreen();
  await hui.open(`/sessions/${session.id}`);
  await screen.getByRole("button", "Show Work pane").tap();
  await screen.getByRole("button", "Open Work view").tap();
  await screen.getByText(diff).first().tap();
  await screen.getByText("blob.bin", { exact: true }).first().tap();
  await expect(screen.getByText("Binary file", { exact: true })).toBeVisible();
  await expect(screen.getByText(/it has no text to compare/u)).toBeVisible();
});
