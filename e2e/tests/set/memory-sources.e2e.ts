/** Memory lists the workspace sources or says there are none, and a failed read can retry (SET-072). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("Memory lists its workspace sources or says there are none and recovers from a failed read", { tags: ["SET-072"], platforms: ["web"] }, async ({ screen, hui }) => {
  // A held request stands in for the failure: the phone target's WebView cannot take the engine's answer-every-request
  // stub, so the one read is held, refused and released to the real gateway.
  const failing = await hui.intercept("GET", /\/__hui\/workspaces$/u);
  await hui.open("/settings/memory");
  await failing.arrived();
  await failing.reject(503, "The workspace inventory could not be read.");
  await expect(screen.getByText(/The workspace inventory could not be read\./u)).toBeVisible();
  await expect(screen.getByRole("button", "Retry")).toBeVisible();

  await screen.getByRole("button", "Retry").click();
  await expect(screen.getByText("No workspace memory sources found.", { exact: true })).toBeVisible();
});
