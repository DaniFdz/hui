/** A binary file, a patch over 1,500 lines, a missing final newline and mixed CRLF endings are each marked in the Diff
 * view (WORK-067). */
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";
import { openWork } from "./work-views.ts";

test("a binary file, a patch over 1,500 lines, a missing final newline and mixed CRLF endings are marked", { tags: ["WORK-067"], platforms: ["web"] }, async ({ screen, hui }) => {
  const repository = await hui.repository();
  await writeFile(join(repository.path, "bin.dat"), Buffer.from([0x00, 0x01, 0x02, 0x03]));
  const lines = Array.from({ length: 1_600 }, (_, index) => `big line ${index + 1}`);
  await writeFile(join(repository.path, "big.txt"), `${lines.join("\n")}\n`);
  await writeFile(join(repository.path, "eof.txt"), "one\ntwo");
  await writeFile(join(repository.path, "mixed.txt"), "one\r\ntwo\nthree\r\n");
  const session = await hui.createSession({ title: "Marked changes", cwd: repository.path });

  await hui.open(`/sessions/${session.id}`);
  await openWork(screen, "Diff");
  const changed = screen.getByLabel("Changed files");
  // A pane too narrow for the list beside the diff shows one of them; Back to changed files returns to the list.
  const pick = async (name: string) => {
    const back = screen.getByRole("button", "Back to changed files").first();
    if ((await back.count()) > 0 && await back.isVisible()) await back.tap();
    await changed.getByRole("button").filter({ hasText: name }).tap();
  };

  await pick("bin.dat");
  await expect(screen.getByText("Binary file")).toBeVisible();
  await expect(screen.getByText("Added; it has no text to compare.")).toBeVisible();

  // The long patch opens collapsed, and Show diff draws it.
  await pick("big.txt");
  await expect(screen.getByText("Large diff")).toBeVisible();
  const hunk = screen.getByText(/@@ -0,0 \+1,1600 @@/u);
  await expect(hunk).toHaveCount(0);
  await screen.getByRole("button", "Show diff").tap();
  await expect(hunk).toBeVisible();
  await expect(screen.getByText("Large diff")).toHaveCount(0);

  await pick("eof.txt");
  await expect(screen.getByText("No newline at end of file").first()).toBeVisible();

  await pick("mixed.txt");
  await expect(screen.getByLabel("CRLF").first()).toBeVisible();
});
