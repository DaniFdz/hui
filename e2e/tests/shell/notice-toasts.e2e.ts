/** A run that retries after a provider error narrates it in a warning toast that closes when the run ends in an error card, and a primary that fails before producing output hands over to the fallback model with another warning toast (SHELL-027). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("a retrying run warns until its error card, and a failed primary warns again when the fallback model takes over", { tags: ["SHELL-027"], platforms: ["web"] }, async ({ screen, hui }) => {
  const settings = await hui.api<{ models: Record<string, string> }>("GET", "/__hui/settings");
  const message = screen.getByLabel("Message");
  const retryToast = screen.getByText(/^Retrying after a provider error \(attempt 1\): /u);
  const failed = screen.getByRole("button", "Copy error");

  await hui.api("PUT", "/__hui/settings", { ...settings, models: { primary: "hui-e2e/fixture", fallback: "", utility: "hui-e2e/fixture" } });
  const retrying = await hui.createSession({ title: "Retry the provider" });
  await hui.open(`/sessions/${retrying.id}`);
  await message.fill("E2E_ERROR");
  await screen.getByRole("button", "Send message").tap();
  await expect(retryToast).toBeVisible();
  await expect(failed).toBeVisible({ timeout: 60_000 });
  await expect(retryToast).toBeHidden();

  await hui.api("PUT", "/__hui/settings", { ...settings, models: { primary: "hui-e2e/fixture", fallback: "hui-e2e/anthropic/claude-opus-5-5", utility: "hui-e2e/fixture" } });
  const fallen = await hui.createSession({ title: "Fall back to another model" });
  await hui.open(`/sessions/${fallen.id}`);
  const fallbackToast = screen.getByText("Primary model failed before producing output. Retrying with hui-e2e/anthropic/claude-opus-5-5.", { exact: true });
  await message.fill("E2E_PRIMARY_ERROR E2E_COMMAND_RUNNING");
  await screen.getByRole("button", "Send message").tap();
  await hui.provider.held();
  await expect(fallbackToast).toBeVisible();
  await hui.provider.release();
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();
  await expect(fallbackToast).toBeHidden();
});