/** Memory lists the workspace sources or says there are none, and a failed read can retry (SET-072). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("Memory lists its workspace sources or says there are none and recovers from a failed read", { tags: ["SET-072"], platforms: ["web"] }, async ({ screen, hui }) => {
  const failing = await hui.answerAll("GET", /\/__hui\/workspaces$/u, JSON.stringify({ error: "The workspace inventory could not be read." }), 503);
  await hui.open("/settings/memory");
  await expect(screen.getByText(/The workspace inventory could not be read\./u)).toBeVisible();
  await expect(screen.getByRole("button", "Retry")).toBeVisible();
  await failing.stop();

  await screen.getByRole("button", "Retry").click();
  await expect(screen.getByText("No workspace memory sources found.", { exact: true })).toBeVisible();
});
