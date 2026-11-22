/** A folder that is not a Git repository shows why and offers Check again in the Diff view (WORK-073). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";
import { openWork } from "./work-views.ts";

test("the Diff view says a folder is not a Git repository and can check again", { tags: ["WORK-073"], platforms: ["web"] }, async ({ screen, hui }) => {
  const session = await hui.createSession({ title: "No git" });

  await hui.open(`/sessions/${session.id}`);
  await openWork(screen, "Diff");
  await expect(screen.getByText("Not a Git repository", { exact: true })).toBeVisible();
  await expect(screen.getByRole("button", "Check again")).toBeVisible();
});
