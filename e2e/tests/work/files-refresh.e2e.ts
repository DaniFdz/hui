/** The Files view follows the disk without a reload: an open folder and a clean open file show what is there now when
 * the agent's turn ends, when the view is shown again and on Refresh (WORK-047). */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";
import { leaveWork, openWork, resumeWork, showFiles } from "./work-views.ts";

/** A tool call the fixture provider runs for real, the way the model would ask HUI to. */
const calls = (list: { name: string; input: Record<string, unknown> }[]) => `E2E_CALL:${Buffer.from(JSON.stringify(list)).toString("base64url")}`;

test("an open folder and a clean open file show the disk's current contents when the agent's turn ends, when the view is shown again and on Refresh", { tags: ["WORK-047"], platforms: ["web"] }, async ({ screen, hui }) => {
  const repository = await hui.repository();
  const notes = join(repository.path, "notes.txt");
  await writeFile(notes, "alpha\n");
  await mkdir(join(repository.path, "docs"));
  await writeFile(join(repository.path, "docs", "a.md"), "# A\n");
  const session = await hui.createSession({ title: "Changed files", cwd: repository.path });
  const navigator = screen.getByLabel("Files navigator");
  const editor = screen.getByLabel(/Contents of .*notes\.txt/u);
  const pane = screen.getByLabel("Work pane");

  await hui.open(`/sessions/${session.id}`);
  await openWork(screen, "Files");
  await showFiles(screen);
  await navigator.getByRole("button", "docs").tap();
  await expect(navigator.getByRole("button", "a.md")).toBeVisible();
  await navigator.getByRole("button", "notes.txt").tap();
  await expect(editor).toHaveText(/alpha/u);

  // A turn that writes the file and adds one to the open folder brings both without a reload.
  await hui.prompt(session, calls([
    { name: "write", input: { path: notes, content: "beta\n" } },
    { name: "write", input: { path: join(repository.path, "docs", "added.md"), content: "# Added\n" } },
  ]));
  // The turn's end is the chat's to show: a phone leaves the full-screen destination for it, a wide screen shows both.
  await leaveWork(screen);
  await expect(screen.getByTestId("transcript").getByText("Used 2 tools")).toBeVisible();
  await resumeWork(hui, screen, "notes.txt");
  // A narrow view keeps its navigator in a drawer, which coming back to the view leaves shut.
  await showFiles(screen);
  await expect(editor).toHaveText(/beta/u);
  await expect(navigator.getByRole("button", "added.md")).toBeVisible();

  // Refresh reads the disk again, the open folder included.
  await writeFile(notes, "gamma\n");
  await writeFile(join(repository.path, "docs", "extra.md"), "# Extra\n");
  await screen.getByRole("button", "Refresh").tap();
  await expect(editor).toHaveText(/gamma/u);
  await expect(navigator.getByRole("button", "extra.md")).toBeVisible();

  // So does showing the view again after another tab had the pane.
  await writeFile(notes, "delta\n");
  await openWork(screen, "Diff");
  await expect(pane.getByRole("tab", "Diff")).toHaveAttribute("aria-selected", "true");
  await pane.getByRole("tab", "notes.txt").tap();
  await expect(editor).toHaveText(/delta/u);
});
