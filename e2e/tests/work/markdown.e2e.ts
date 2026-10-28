/** A Markdown file in the Files view: rendered with its headings, lists, tables and code block, then Source, which
 * edits the file on disk (WORK-048). */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("a Markdown file opens rendered with its headings, lists, tables and code blocks, and Source shows and edits it", { tags: ["WORK-048"], platforms: ["web"] }, async ({ screen, hui }) => {
  const repository = await hui.repository();
  const source = [
    "# Markdown title", "", "- First item", "- Second item", "",
    "| Column one | Column two |", "| --- | --- |", "| Cell one | Cell two |", "",
    "```js", "const answer = 42;", "```", "",
  ].join("\n");
  await writeFile(join(repository.path, "doc.md"), source);
  const session = await hui.createSession({ title: "Read a Markdown file", cwd: repository.path });
  const navigator = screen.getByLabel("Files navigator");
  const pane = screen.getByLabel("Work pane");

  await hui.open(`/sessions/${session.id}`);
  await hui.openWorkView("Files");
  await navigator.getByRole("button", "doc.md").tap();
  await expect(pane.getByRole("tab", "doc.md")).toBeVisible();

  const rendered = screen.getByRole("button", "Rendered");
  await expect(rendered).toHaveAttribute("aria-pressed", "true");
  const renderedText = await hui.textOf(screen.getByLabel("Editor for doc.md"));
  for (const text of ["Markdown title", "First item", "Second item", "Column one", "Column two", "Cell one", "Cell two", "const answer = 42;"]) {
    expect(renderedText).toContain(text);
  }
  expect(renderedText).not.toContain("| --- |");

  await expect(screen.getByRole("button", "Copy code")).toBeVisible();

  await screen.getByRole("button", "Source").tap();
  await expect(screen.getByRole("button", "Source")).toHaveAttribute("aria-pressed", "true");
  const editor = screen.getByLabel(/Contents of .*doc\.md$/u);
  await expect(editor).toContainText("# Markdown title");
  await expect(editor).toContainText("| Column one | Column two |");
  await editor.fill(`${source}Edited as source\n`);
  await expect.poll(async () => readFile(join(repository.path, "doc.md"), "utf8")).toContain("Edited as source");
});
