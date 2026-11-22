/** Privacy & Security states the Full Access runtime model, the browser API guard and what diagnostics leave out, and a failed read says why until Retry recovers (SET-073). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("Privacy & Security shows the runtime boundaries and recovers after a failed read", { tags: ["SET-073"], platforms: ["web"] }, async ({ screen, hui }) => {
  const page = screen.getByTestId("settings-page");

  await hui.open("/settings/security");
  await expect(page.getByText("Full Access", { exact: true })).toBeVisible();
  await expect(page.getByText("x-hui: 1", { exact: true })).toBeVisible();
  await expect(page.getByText("HTTP + SSE", { exact: true })).toBeVisible();
  await expect(page.getByText("PI credential sources", { exact: true })).toBeVisible();
  await expect(page.getByText("Values redacted", { exact: true })).toBeVisible();
  await expect(page.getByText("Excluded", { exact: true })).toBeVisible();
  await expect(page.getByText("Retention", { exact: true })).toBeVisible();

  // A held request stands in for the failure: the phone target's WebView cannot take the engine's answer-every-request
  // stub, so the read that follows the reload is held, refused and then released to the real gateway by Retry.
  const failing = await hui.intercept("GET", /\/__hui\/health$/u);
  await hui.reload();
  await failing.arrived();
  await failing.reject(503, "The gateway is not answering.");
  await expect(page.getByText(/The gateway is not answering\./u)).toBeVisible();
  await expect(page.getByRole("button", "Retry")).toBeVisible();
  await page.getByRole("button", "Retry").click();
  await expect(page.getByText("HTTP + SSE", { exact: true })).toBeVisible();
});
