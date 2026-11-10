/** The Files view follows the disk: an open folder and a clean open file show what changed when the agent's turn ends,
 * when the view is shown again and on Refresh (WORK-047). */
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";
import { openWork, showFiles } from "./work-views.ts";

/** Tool calls the fixture provider asks HUI to run in one answer, the way the model would. */
const calls = (list: { name: string; input: Record<string, unknown> }[]) => `E2E_CALL:${Buffer.from(JSON.stringify(list)).toString("base64url")}`;

test("an open folder and a clean open file show the disk's changes at the turn's end, on Refresh and when the view is shown again", { tags: ["WORK-047"], platforms: ["web"] }, async ({ screen, hui }) => {
  const repository = await hui.repository();
  const keep = join(repository.path, "sub", "keep.txt");
  await writeFile(keep, "before\n");
  const session = await hui.createSession({ title: "Files follow the disk", cwd: repository.path });
  const navigator = screen.getByLabel("Files navigator");
  const editor = screen.getByLabel(/Contents of .*keep\.txt/u);

  await hui.open(`/sessions/${session.id}`);
  await openWork(screen, "Files");
  await showFiles(screen);
  await navigator.getByRole("button", "sub").tap();
  await navigator.getByRole("button", "keep.txt").tap();
  await expect(editor).toHaveText("before");

  // Nothing is re-read by itself: the open folder and the clean file still show what they were opened with.
  await writeFile(keep, "after\n");
  await writeFile(join(repository.path, "sub", "fresh.txt"), "fresh\n");
  await expect(editor).toHaveText("before");
  await expect(navigator.getByRole("button", "fresh.txt")).toHaveCount(0);

  // Refresh re-reads both.
  await navigator.getByRole("button", "Refresh").tap();
  await expect(navigator.getByRole("button", "fresh.txt")).toBeVisible();
  await expect(editor).toHaveText("after");

  // The agent's turn ends on a changed folder and file, and the view follows that too.
  await hui.prompt(session, calls([
    { name: "write", input: { path: join(repository.path, "sub", "written-by-agent.txt"), content: "the agent wrote this\n" } },
    { name: "write", input: { path: keep, content: "the agent changed this\n" } },
  ]));
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();
  await expect(navigator.getByRole("button", "written-by-agent.txt")).toBeVisible();
  await expect(editor).toHaveText("the agent changed this");

  // Hiding the pane and showing it again re-reads once more.
  await writeFile(keep, "changed again on disk\n");
  await writeFile(join(repository.path, "sub", "later.txt"), "later\n");
  await expect(editor).toHaveText("the agent changed this");
  await screen.getByRole("button", "Hide Work pane").tap();
  await screen.getByRole("button", "Show keep.txt").tap();
  await expect(navigator.getByRole("button", "later.txt")).toBeVisible();
  await expect(editor).toHaveText("changed again on disk");
});
