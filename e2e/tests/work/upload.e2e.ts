/** Upload files into the Files view's folder, and watch or cancel one in flight: the upload lands in the tree, an
 * existing file is replaced only after the confirmation (WORK-054), and the navigator shows its progress and stops it
 * with Cancel upload (WORK-082). */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("Upload files writes them into the folder, and an existing file is replaced only after Replace", { tags: ["WORK-054"], platforms: ["web"] }, async ({ screen, hui }) => {
  const repository = await hui.repository();
  const session = await hui.createSession({ title: "Upload files", cwd: repository.path });
  const navigator = screen.getByLabel("Files navigator");
  await hui.open(`/sessions/${session.id}`);
  await hui.openWorkView("Files");
  await expect(navigator.getByRole("button", "Upload files")).toBeVisible();

  await hui.attach(screen.getByTestId("files-upload-input"), [{ name: "notes.txt", bytes: 16 }]);
  await expect(navigator.getByText(/Uploaded “notes\.txt” to /u)).toBeVisible();
  await expect(navigator.getByRole("button", "notes.txt")).toBeVisible();
  assert.equal(await readFile(join(repository.path, "notes.txt"), "utf8"), "x".repeat(16));

  await writeFile(join(repository.path, "readme.md"), "# original\n");
  await hui.attach(screen.getByTestId("files-upload-input"), [{ name: "readme.md", bytes: 8 }]);
  await expect(screen.getByText("Replace the existing file?")).toBeVisible();
  assert.equal(await readFile(join(repository.path, "readme.md"), "utf8"), "# original\n", "nothing is written before Replace");
  await screen.getByRole("button", "Replace").tap();
  await expect(navigator.getByText(/Uploaded “readme\.md” to /u)).toBeVisible();
  assert.equal(await readFile(join(repository.path, "readme.md"), "utf8"), "x".repeat(8));
});

test("an upload shows its progress and Cancel upload leaves the folder unchanged", { tags: ["WORK-082"], platforms: ["web"] }, async ({ app, screen, hui }) => {
  const repository = await hui.repository();
  const session = await hui.createSession({ title: "Cancel an upload", cwd: repository.path });
  const navigator = screen.getByLabel("Files navigator");
  await hui.open(`/sessions/${session.id}`);
  await hui.openWorkView("Files");
  await expect(navigator.getByRole("button", "Upload files")).toBeVisible();

  // The gateway never sees this body: the request is held open so the state the browser shows while uploading stays put.
  const held = await hui.intercept("POST", /\/files\/upload\?/u);
  await hui.attach(screen.getByTestId("files-upload-input"), [{ name: "clip.mov", bytes: 12 * 1024 }]);
  await held.arrived();
  await expect(navigator.getByRole("progressbar")).toBeVisible();
  await expect(navigator.getByText(/^\d+%$/u)).toBeVisible();
  await expect(navigator.getByText(/Uploading “clip\.mov”/u)).toBeVisible();
  await app.screenshot("files-upload-progress");

  await navigator.getByRole("button", "Cancel upload").tap();
  await expect(navigator.getByText(/Upload cancelled; .+ was not changed\./u)).toBeVisible();
  await expect(navigator.getByRole("progressbar")).toHaveCount(0);
  await expect(navigator.getByRole("button", "clip.mov")).toHaveCount(0);
  await assert.rejects(readFile(join(repository.path, "clip.mov")), /ENOENT/u);
  // The browser dropped the request when it was cancelled; releasing the held route lets the run settle.
  await held.deliver().catch(() => undefined);
});
