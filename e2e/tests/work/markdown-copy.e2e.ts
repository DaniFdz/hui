/** A Markdown file's Copy Markdown button copies the file's Markdown source and confirms it (WORK-081). */
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

const MARKDOWN = "# Copy me\n\n| Area | Status |\n| --- | --- |\n| Files | Done |\n";

test("Copy Markdown copies a Markdown file's source and confirms it", { tags: ["WORK-081"], platforms: ["web"] }, async ({ screen, hui }) => {
  await writeFile(join(hui.workspace, "copy-markdown.md"), MARKDOWN);
  const session = await hui.createSession({ title: "Copy a Markdown file" });
  await hui.open(`/sessions/${session.id}`);
  await screen.getByRole("button", "Show Work pane").tap();
  await screen.getByRole("button", /^Files/u).tap();
  await screen.getByRole("button", "copy-markdown.md").tap();
  await expect(screen.getByText("Copy me")).toBeVisible();

  await hui.clipboardSpy();
  const copy = screen.getByRole("button", "Copy Markdown");
  await copy.tap();
  await expect(copy).toHaveAttribute("data-hui-tooltip", "Copied");
  await expect.poll(() => hui.clipboardWrites()).toEqual([MARKDOWN]);
});
