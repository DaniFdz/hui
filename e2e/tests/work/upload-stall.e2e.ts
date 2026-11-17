/** An upload whose bytes stop moving fails on its own deadline instead of hanging (WORK-054): one second before it the
 * Files pane still shows the progress bar and Cancel upload, half a second past it the status line names how far the
 * transfer got and says nothing was saved, and the folder really is unchanged. What this cannot prove is the deadline's
 * other message — every byte out, no answer, "the upload may have finished" — because a held route never lets the body
 * leave the browser, so the browser reports no byte sent and only the body-phase line is reachable here; the
 * response-phase half is proved where the upload's own phase switch is, in src/api/files.test.ts. */
import assert from "node:assert/strict";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join, sep } from "node:path";
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";
import { openWork } from "./work-views.ts";

test("an upload that stops making progress fails on its deadline and leaves the folder unchanged", { tags: ["WORK-054"], platforms: ["web"] }, async ({ screen, hui }) => {
  const repository = await hui.repository();
  const session = await hui.createSession({ title: "Upload stall", cwd: repository.path });
  const navigator = screen.getByLabel("Files navigator");
  // A file the attempt must leave alone: the status line promises the folder is unchanged.
  await writeFile(join(repository.path, "readme.md"), "# original\n");
  await hui.open(`/sessions/${session.id}`);
  await openWork(screen, "Files");
  await expect(navigator.getByRole("button", "Upload files")).toBeVisible();
  await expect(navigator.getByRole("button", "readme.md")).toBeVisible();

  // The page's own clock, so both sides of the 40-second deadline are read without waiting for either.
  await hui.controllableClock();
  // The gateway never sees this body: the request is held before the browser hands over a byte, so the deadline is
  // measuring a body that never moved and the pane stays in the phase it was held in.
  const held = await hui.intercept("POST", /\/files\/upload\?/u);
  await hui.attach(screen.getByTestId("files-upload-input"), [{ name: "clip.mov", bytes: 12 * 1024 }]);
  await held.arrived();
  await expect(navigator.getByText("Uploading “clip.mov”…")).toBeVisible();

  // One second before the deadline the transfer is still running, with no failure line anywhere.
  await hui.advanceClock(39_000);
  await expect(navigator.getByText("Uploading “clip.mov”…")).toBeVisible();
  await expect(navigator.getByRole("progressbar")).toBeVisible();
  await expect(navigator.getByRole("button", "Cancel upload")).toBeVisible();
  await expect(navigator.getByText(/stopped uploading/u)).toHaveCount(0);

  // Half a second past it the pane fails the upload, says how far it got and that nothing was saved.
  await hui.advanceClock(1_500);
  const stalled = "Upload failed: clip.mov: “clip.mov” stopped uploading at 0% (0 B of 12 KB sent). Nothing was saved and the folder is unchanged. Check the connection and try again.";
  await expect(navigator.getByRole("status")).toHaveText(stalled);
  await expect(navigator.getByRole("button", "Cancel upload")).toHaveCount(0);
  await expect(navigator.getByRole("progressbar")).toHaveCount(0);
  await expect(navigator.getByRole("button", "clip.mov")).toHaveCount(0);

  // The deadline aborted the request, which the browser drops: releasing the held route answers Playwright without
  // carrying a body anywhere, so the run settles here instead of leaving the route behind.
  await held.deliver();

  // …and the workspace is as it was: no half-written temporary file, and the file that was there keeps its bytes.
  const leftovers = (await readdir(repository.path, { recursive: true })).filter((name) => name.split(sep).some((part) => part.startsWith(".hui-files-")));
  assert.deepEqual(leftovers, [], "the stalled upload left a temporary file behind");
  assert.equal(await readFile(join(repository.path, "readme.md"), "utf8"), "# original\n", "an existing file keeps its bytes");
  await assert.rejects(readFile(join(repository.path, "clip.mov")), /ENOENT/u);
});
