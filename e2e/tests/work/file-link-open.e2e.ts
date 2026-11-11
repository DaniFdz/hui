/** Clicking a file link the agent wrote in its reply opens the conversation's Files view on that file at its line —
 * expanding a hidden Work pane, expanding the navigator to the file, marking the line it names and switching a Markdown
 * file to Source — while a folder link expands that folder (WORK-059). The mark itself is the editor's, so the test reads
 * the class CodeMirror puts on the line it revealed, found by the line's own text. */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("a file link opens the Files view on that file at its line and a folder link expands it", { tags: ["WORK-059"], platforms: ["web"] }, async ({ screen, hui }) => {
  const repository = await hui.repository();
  const kept = Array.from({ length: 60 }, (_, index) => `export const line${index + 1} = ${index + 1};`).join("\n");
  await mkdir(join(repository.path, "src", "lib"), { recursive: true });
  await writeFile(join(repository.path, "src", "lib", "greeting.ts"), `${kept}\n`);
  await writeFile(join(repository.path, "README.md"), "# Read me\n");
  await mkdir(join(repository.path, "docs"));
  await writeFile(join(repository.path, "docs", "design.md"), "# Design\n");
  const session = await hui.createSession({ title: "File links open Files", cwd: repository.path });
  const transcript = screen.getByTestId("transcript");
  const pane = screen.getByLabel("Work pane");
  const navigator = screen.getByLabel("Files navigator");
  const editor = (path: string) => screen.getByLabel(`Contents of ${path}`);
  /** The tab strip's captions, left to right. */
  const order = async () => Promise.all((await pane.getByRole("tab").all()).map(async (tab) => (await hui.textOf(tab)).trim()));
  /** The class CodeMirror puts on the line a reveal landed on, read off the one element holding that line's text. */
  const marked = async (path: string, line: string) => (await editor(path).getByText(line, { exact: true }).getAttribute("class")) ?? "";

  await hui.open(`/sessions/${session.id}`);
  await hui.prompt(session, "E2E_FILE_LINKS");
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();
  // The pane the link expands is the rail's: nothing opened it first.
  await expect(screen.getByRole("button", "Show Work pane")).toBeVisible();

  await transcript.getByRole("link", "Open src/lib/greeting.ts at line 3 in Files").tap();
  await expect(pane.getByRole("tab", "greeting.ts")).toHaveAttribute("aria-selected", "true");
  // The navigator opened the folders down to the file and marks it as the one on screen.
  await expect(navigator.getByRole("button", "src")).toHaveAttribute("aria-expanded", "true");
  await expect(navigator.getByRole("button", "lib")).toHaveAttribute("aria-expanded", "true");
  await expect(navigator.getByRole("button", "greeting.ts")).toHaveAttribute("aria-current", "true");
  // The editor scrolled to line 3 and marks it; no other line of the file is marked.
  await expect.poll(() => marked("src/lib/greeting.ts", "export const line3 = 3;")).toContain("cm-hui-target-line");
  expect(await editor("src/lib/greeting.ts").getByText("export const line4 = 4;").getAttribute("class")).toBe("cm-line");

  // A second link for the same file reuses the active Files tab, and marks the line it names.
  await transcript.getByRole("link", "Open src/lib/greeting.ts at line 58 in Files").tap();
  await expect(pane.getByRole("tab", "greeting.ts")).toHaveAttribute("aria-selected", "true");
  await expect.poll(() => marked("src/lib/greeting.ts", "export const line58 = 58;")).toContain("cm-hui-target-line");

  // A folder link expands that folder in the navigator, over the folder the file is in.
  await transcript.getByRole("link", "Open folder docs in Files").tap();
  await expect(navigator.getByRole("button", "docs")).toHaveAttribute("aria-expanded", "true");
  await expect(navigator.getByRole("button", "src")).toHaveAttribute("aria-expanded", "true");

  // With a second Files view open and active, a link goes to that one: the first tab keeps its file.
  await screen.getByRole("button", "Open Work view").tap();
  await screen.getByRole("menuitem").filter({ hasText: "Files" }).tap();
  await expect(pane.getByRole("tab", "Files")).toHaveAttribute("aria-selected", "true");
  await transcript.getByRole("link", "Open README.md in Files").tap();
  await expect(pane.getByRole("tab", "README.md")).toHaveAttribute("aria-selected", "true");
  await expect(pane.getByRole("tab", "greeting.ts")).toHaveAttribute("aria-selected", "false");

  // With another view active, the link goes to the conversation's first Files tab; a Markdown file opens as Source so
  // the line it names can be marked at all.
  await screen.getByRole("button", "Open Work view").tap();
  await screen.getByRole("menuitem").filter({ hasText: "New terminal" }).tap();
  await expect(pane.getByRole("tab", "Terminal 1")).toHaveAttribute("aria-selected", "true");
  await transcript.getByRole("link", "Open docs/design.md at line 2 in Files").tap();
  await expect(pane.getByRole("tab", "design.md")).toHaveAttribute("aria-selected", "true");
  await expect(screen.getByRole("button", "Source")).toHaveAttribute("aria-pressed", "true");
  await expect(screen.getByRole("button", "Rendered")).toHaveAttribute("aria-pressed", "false");
  await expect(editor("docs/design.md")).toBeVisible();
  // It is the first Files tab that took it: the second one still shows README.md.
  expect(await order()).toEqual(["design.md", "README.md", "Terminal 1"]);
});
