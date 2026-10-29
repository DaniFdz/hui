/** The sidebar's Files tab lists the conversation's folder and opens a chosen file in its Files view (WORK-082). */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("the sidebar's Files tab lists the conversation's files and opens one in its Files view", { tags: ["WORK-082"], platforms: ["web"] }, async ({ screen, hui }) => {
  await mkdir(join(hui.workspace, "sidebar-files"), { recursive: true });
  await writeFile(join(hui.workspace, "sidebar-files", "sidebar-note.md"), "# Opened from the sidebar\n");
  const session = await hui.createSession({ title: "Browse files from the sidebar" });
  await hui.open(`/sessions/${session.id}`);

  await screen.getByRole("tab", "Files").tap();
  await screen.getByRole("button", "sidebar-files").tap();
  await screen.getByRole("button", "sidebar-note.md").tap();
  await expect(screen.getByText("Opened from the sidebar")).toBeVisible();
  await expect(screen.getByRole("tab", "sidebar-note.md")).toBeVisible();

  await screen.getByRole("tab", "Agents").tap();
  await expect(screen.getByRole("button", "Actions for Browse files from the sidebar")).toBeVisible();
});
