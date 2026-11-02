/** A folder that is not a Git repository shows why and offers Check again in the Diff view (WORK-073). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("the Diff view says a folder is not a Git repository and can check again", { tags: ["WORK-073"], platforms: ["web"] }, async ({ screen, hui }) => {
  const session = await hui.createSession({ title: "No git" });
  const diff = new RegExp("(?:⌥⇧⌘|Ctrl\\+Alt\\+Shift\\+|Alt\\+Shift\\+Ctrl\\+)D", "u");

  await hui.wideScreen();
  await hui.open(`/sessions/${session.id}`);
  await screen.getByRole("button", "Show Work pane").tap();
  await screen.getByRole("button", "Open Work view").tap();
  await screen.getByText(diff).first().tap();
  await expect(screen.getByText("Not a Git repository", { exact: true })).toBeVisible();
  await expect(screen.getByRole("button", "Check again")).toBeVisible();
});
