/** The Files view on a narrow screen: the editor takes the full width at 16 px, and the navigator is a drawer over a
 * dimmed backdrop that closes on a selection, on its close button or on the backdrop (WORK-056). */
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";
import { openWork, showFiles } from "./work-views.ts";

test("on a narrow screen the editor takes the full width at 16 px and the navigator drawer closes on a selection, its close button or the backdrop", { tags: ["WORK-056"], platforms: ["web"] }, async ({ screen, hui }) => {
  const repository = await hui.repository();
  await writeFile(join(repository.path, "notes.txt"), "first\nsecond\n");
  const session = await hui.createSession({ title: "Narrow files", cwd: repository.path });
  const navigator = screen.getByLabel("Files navigator");
  const editor = screen.getByLabel(/Contents of .*notes\.txt/u);
  const section = screen.getByLabel(/^Editor for .*notes\.txt/u);
  // Two controls are named for closing the drawer: its own close button in the navigator, then the backdrop behind it.
  const backdrop = screen.getByRole("button", "Close files navigator").last();

  const phone = await hui.phoneScreen();
  await hui.open(`/sessions/${session.id}`);
  await openWork(screen, "Files");
  await showFiles(screen);
  await expect(navigator).toBeVisible();

  // Choosing a file closes the drawer and shows the file across the screen.
  await navigator.getByRole("button", "notes.txt").tap();
  await expect(navigator).toBeHidden();
  await expect(backdrop).toHaveCount(0);
  await expect(editor).toBeVisible();
  const alone = (await section.boundingBox())!;
  expect(alone.width).toBeGreaterThan(phone.width - 20);
  expect((await hui.look(editor)).size).toBe(16);

  // The drawer lies over the editor instead of narrowing it, and its own close button leaves the file open.
  await showFiles(screen);
  await expect(navigator).toBeVisible();
  expect(Math.round((await section.boundingBox())!.width)).toBe(Math.round(alone.width));
  await navigator.getByRole("button", "Close files navigator").tap();
  await expect(navigator).toBeHidden();
  await expect(editor).toBeVisible();

  // So does the backdrop: the drawer lies over the left of it, so the tap lands on the dimmed area beside the drawer.
  await showFiles(screen);
  await expect(navigator).toBeVisible();
  const dimmed = (await backdrop.boundingBox())!;
  await backdrop.tap({ position: { x: dimmed.width - 6, y: dimmed.height / 2 } });
  await expect(navigator).toBeHidden();
  await expect(editor).toBeVisible();
});
