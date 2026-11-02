/** Editing a text file and saving writes the change to disk (WORK-044). */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("editing a text file and saving writes the change to disk", { tags: ["WORK-044"], platforms: ["web"] }, async ({ screen, hui }) => {
  const session = await hui.createSession({ title: "Edit a file" });

  await hui.wideScreen();
  await hui.open(`/sessions/${session.id}`);
  await screen.getByRole("button", "Show Work pane").tap();
  await screen.getByRole("button", { name: /^Files/u }).tap();
  await screen.getByText("fixture.txt", { exact: true }).tap();

  const editor = screen.getByLabel("Contents of fixture.txt");
  await expect(editor).toBeVisible();
  await editor.click();
  await editor.press("Control+End");
  await hui.type(" edited by test");
  await editor.press("Control+s");
  await expect.poll(async () => (await readFile(join(hui.workspace, "fixture.txt"), "utf8")).includes("edited by test")).toBe(true);
});
