/** The Files view's previews: an image and a PDF show themselves, while a binary file and a text file over 2 MB say
 * what they are and offer their size, modification time and Download (WORK-049). */
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";
import { openWork, showFiles } from "./work-views.ts";

const PIXEL = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const PDF = Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n");
/** A text file past the 2 MB the editor takes, so the view must refuse it instead of opening it. */
const HUGE = `${"a line of text that is long enough to weigh a byte count\n".repeat(40_000)}`;

test("an image and a PDF preview, while a binary file and a text file over 2 MB say what they are with their size, modified time and Download", { tags: ["WORK-049"], platforms: ["web"] }, async ({ screen, hui }) => {
  const repository = await hui.repository();
  await writeFile(join(repository.path, "pixel.png"), PIXEL);
  await writeFile(join(repository.path, "doc.pdf"), PDF);
  await writeFile(join(repository.path, "blob.bin"), Buffer.from([0x00, 0x01, 0x02, 0x03]));
  await writeFile(join(repository.path, "huge.txt"), HUGE);
  const session = await hui.createSession({ title: "Preview files", cwd: repository.path });

  await hui.open(`/sessions/${session.id}`);
  await openWork(screen, "Files");
  await showFiles(screen);

  await screen.getByRole("button", "pixel.png").tap();
  await expect(screen.getByRole("img", "pixel.png")).toBeVisible();

  await showFiles(screen);
  await screen.getByRole("button", "doc.pdf").tap();
  await expect(screen.getByLabel("doc.pdf")).toBeVisible();

  await showFiles(screen);
  await screen.getByRole("button", "blob.bin").tap();
  await expect(screen.getByText("Binary file: it has no text to show here.")).toBeVisible();
  const binary = await hui.textOf(screen.getByLabel(/^Editor for .*blob\.bin/u));
  expect(binary).toMatch(/Size\s*\S+/u);
  expect(binary).toMatch(/Modified\s*\S+/u);
  await expect(screen.getByRole("button", "Download").first()).toBeVisible();

  await showFiles(screen);
  await screen.getByRole("button", "huge.txt").tap();
  await expect(screen.getByText(/Too large to edit here \(.* the limit is 2 MB\)\./u)).toBeVisible();
  const large = await hui.textOf(screen.getByLabel(/^Editor for .*huge\.txt/u));
  expect(large).toMatch(/Size\s*\S+/u);
  expect(large).toMatch(/Modified\s*\S+/u);
  await expect(screen.getByRole("button", "Download").first()).toBeVisible();
  await expect(screen.getByLabel(/Contents of .*huge\.txt/u)).toHaveCount(0);
});
