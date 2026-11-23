/** On a narrow screen a file link in the reply opens the Files view as the Work destination: the panel selector reads
 * "README.md · Work" and the file is open there (WORK-061). */
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("on a narrow screen tapping a file link switches the panel selector to the Files view with the file open", { tags: ["WORK-061"], platforms: ["web"] }, async ({ screen, hui }) => {
  const repository = await hui.repository();
  await writeFile(join(repository.path, "README.md"), "# Read me\n");
  const session = await hui.createSession({ title: "A file link on a phone", cwd: repository.path });
  const transcript = screen.getByTestId("transcript");
  const selector = screen.getByRole("button", { name: /^Active panel/u });
  const pane = screen.getByLabel("Work pane");

  await hui.phoneScreen();
  await hui.open(`/sessions/${session.id}`);
  await hui.prompt(session, "E2E_FILE_LINKS");
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();
  await expect(selector).toHaveAttribute("aria-label", /Chat/u);

  await transcript.getByRole("link", "Open README.md in Files").tap();
  // The narrow screen swaps the chat for the Work destination on that file, and the selector names it.
  await expect(selector).toHaveAttribute("aria-label", "Active panel: README.md · Work");
  await expect(pane.getByRole("tab", "README.md")).toHaveAttribute("aria-selected", "true");
  await expect(screen.getByRole("heading", "Read me")).toBeVisible();
  await expect(screen.getByRole("button", "Back to chat")).toBeVisible();

  // Back to chat returns the conversation, with the view still a choice away.
  await screen.getByRole("button", "Back to chat").tap();
  await expect(selector).toHaveAttribute("aria-label", /Chat/u);
  await selector.tap();
  const view = screen.getByRole("listbox", "Active panel").getByRole("option").filter({ hasText: "README.md" });
  await expect(view).toBeVisible();
  await view.tap();
  await expect(selector).toHaveAttribute("aria-label", "Active panel: README.md · Work");
});
