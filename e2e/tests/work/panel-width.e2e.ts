/** A view's file list widens and narrows from its edge, keeps the width, and shows a cut-off path on hover
 * (WORK-083, WORK-084). */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, type Locator, type Screen } from "e2e";
import { test } from "../../fixtures/hui.ts";

const deepFile = "staff/skills/chief-mode/playbooks/authoring-a-skill.md";

async function dragBoundary(screen: Screen, handle: Locator, x: number) {
  const box = await handle.boundingBox();
  assert(box);
  await screen.swipe({ from: { x: box.x + box.width / 2, y: box.y + box.height / 2 }, to: { x, y: box.y + box.height / 2 } });
}

test("the Files navigator widens and narrows from its edge, keeps the width and shows a full path on hover", { tags: ["WORK-083"], platforms: ["web"] }, async ({ screen, hui }) => {
  const repository = await hui.repository();
  await mkdir(join(repository.path, "staff", "skills", "chief-mode", "playbooks"), { recursive: true });
  await writeFile(join(repository.path, deepFile), "# Authoring a skill\n");
  const session = await hui.createSession({ title: "Widen the Files navigator", cwd: repository.path });

  await hui.wideScreen();
  await hui.open(`/sessions/${session.id}`);
  await hui.openWorkView("Files");
  await screen.getByRole("button", "Maximize Work pane").tap();

  const navigator = screen.getByLabel("Files navigator");
  const handle = screen.getByLabel("Resize files navigator");
  const width = async () => Math.round((await navigator.boundingBox())?.width ?? 0);
  assert.equal(await width(), 260, "the navigator starts at its default width");

  // A drag stops at the widest the navigator may get and at its narrowest.
  await dragBoundary(screen, handle, 1_400);
  await expect.poll(width).toBe(640);

  // Beside the chat the pane is narrower, so the editor's room caps the navigator below the choice.
  await screen.getByRole("button", "Restore Work pane").tap();
  await expect.poll(width).toBeLessThan(640);
  const besideChat = await width();
  expect(besideChat).toBeGreaterThan(300);
  expect(besideChat).toBeLessThanOrEqual(320);
  await screen.getByRole("button", "Maximize Work pane").tap();
  await expect.poll(width).toBe(640);

  await dragBoundary(screen, handle, 0);
  await expect.poll(width).toBe(200);

  // The arrow keys move it instead, by 16px a press or 48px with Shift.
  await handle.press("ArrowRight");
  await expect.poll(width).toBe(216);
  await handle.press("Shift+ArrowRight");
  await expect.poll(width).toBe(264);

  // The navigator comes back at the width it was left at.
  await hui.reload();
  await expect(screen.getByLabel("Files navigator")).toBeVisible();
  await expect.poll(width).toBe(264);

  // A name the width cuts short shows its whole path on hover.
  for (const folder of ["staff", "skills", "chief-mode", "playbooks"]) {
    const row = screen.getByRole("button", folder);
    if (await row.getAttribute("aria-expanded") !== "true") await row.tap();
  }
  await hui.peek(screen.getByRole("button", "authoring-a-skill.md"));
  await expect(screen.getByRole("tooltip")).toHaveText(deepFile);
});

test("the changed-file list widens and narrows from its edge, keeps the width and shows a full path on hover", { tags: ["WORK-084"], platforms: ["web"] }, async ({ screen, hui }) => {
  const repository = await hui.repository();
  await mkdir(join(repository.path, "staff", "skills", "chief-mode", "playbooks"), { recursive: true });
  await writeFile(join(repository.path, deepFile), "# Authoring a skill\n");
  await writeFile(join(repository.path, "readme.md"), "# Notes\n");
  repository.git("add", "readme.md");
  repository.git("commit", "-m", "readme");
  await writeFile(join(repository.path, "readme.md"), "# Notes\nmore\n");
  const session = await hui.createSession({ title: "Widen the changed files", cwd: repository.path });

  await hui.wideScreen();
  await hui.open(`/sessions/${session.id}`);
  await hui.openWorkView("Diff");
  await screen.getByRole("button", "Maximize Work pane").tap();

  const changed = screen.getByLabel("Changed files");
  const handle = screen.getByLabel("Resize changed files");
  const width = async () => Math.round((await changed.boundingBox())?.width ?? 0);
  assert.equal(await width(), 280, "the list starts at its default width");

  await dragBoundary(screen, handle, 1_400);
  await expect.poll(width).toBe(640);
  await dragBoundary(screen, handle, 0);
  await expect.poll(width).toBe(220);

  await handle.press("ArrowRight");
  await expect.poll(width).toBe(236);
  await handle.press("Shift+ArrowRight");
  await expect.poll(width).toBe(284);

  await hui.reload();
  await expect(screen.getByLabel("Changed files")).toBeVisible();
  await expect.poll(width).toBe(284);

  const row = screen.getByLabel("Changed files").getByRole("button").filter({ hasText: "authoring-a-skill.md" });
  await hui.peek(row);
  await expect(screen.getByRole("tooltip")).toHaveText(deepFile);
});
