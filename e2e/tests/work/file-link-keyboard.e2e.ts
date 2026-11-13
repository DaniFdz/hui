/** A file link in the reply is reached with Tab and opened with Enter, which expands the hidden Work pane on the file at
 * the line it names (WORK-062). Tab order is the page's own, so the test presses Tab from the session search box and
 * stops at the link: the press that lands on it is the only one that passes the focus check, and Enter then proves the
 * keyboard — not the pointer — opened the file. */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, type Locator } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("Tab reaches a file link in the reply and Enter opens it in Files at its line", { tags: ["WORK-062"], platforms: ["web"] }, async ({ screen, hui }) => {
  const repository = await hui.repository();
  await mkdir(join(repository.path, "src", "lib"), { recursive: true });
  await writeFile(join(repository.path, "src", "lib", "greeting.ts"), `${Array.from({ length: 60 }, (_, index) => `export const line${index + 1} = ${index + 1};`).join("\n")}\n`);
  await writeFile(join(repository.path, "README.md"), "# Read me\n");
  await mkdir(join(repository.path, "docs"));
  await writeFile(join(repository.path, "docs", "design.md"), "# Design\n");
  const session = await hui.createSession({ title: "Reach a file link", cwd: repository.path });
  const pane = screen.getByLabel("Work pane");
  const link = screen.getByTestId("transcript").getByRole("link", "Open src/lib/greeting.ts at line 3 in Files");
  const editor = screen.getByLabel("Contents of src/lib/greeting.ts");
  /** The class CodeMirror puts on the line a reveal landed on, read off the one element holding that line's text. */
  const marked = async () => (await editor.getByText("export const line3 = 3;", { exact: true }).getAttribute("class")) ?? "";
  /** Presses one key on whatever holds focus, the way the operator does. */
  const press = async (key: string) => {
    await hui.keyboard.down(key);
    await hui.keyboard.up(key);
  };
  /** Whether Tab has arrived at `target`: the check answers briefly instead of waiting, so the loop can press again. */
  const focused = (target: Locator) => expect(target).toBeFocused({ timeout: 60 }).then(() => true, () => false);

  await hui.open(`/sessions/${session.id}`);
  await hui.prompt(session, "E2E_FILE_LINKS");
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();
  // The pane the link has to expand is the rail's: nothing opened it first.
  await expect(screen.getByRole("button", "Show Work pane")).toBeVisible();

  const search = screen.getByRole("searchbox", "Search sessions");
  await search.focus();
  await expect(search).toBeFocused();
  let presses = 0;
  while (!(await focused(link)) && presses < 120) {
    await press("Tab");
    presses += 1;
  }
  expect(presses).toBeLessThan(120);
  await expect(link).toBeFocused();

  // Enter, not a pointer, is what opens it — in the Files view the reply's own link brought up, on its line.
  await press("Enter");
  await expect(pane.getByRole("tab", "greeting.ts")).toHaveAttribute("aria-selected", "true");
  await expect.poll(marked).toContain("cm-hui-target-line");
});
