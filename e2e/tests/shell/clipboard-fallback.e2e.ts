/** Copy response still copies the exact reply where the Clipboard API is unavailable (SHELL-029). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("Copy response copies the exact reply through the legacy selection fallback", { tags: ["SHELL-029"], platforms: ["web"] }, async ({ screen, hui }) => {
  await hui.clipboard({ refuse: true, legacyCopy: true });
  const session = await hui.createSession({ title: "Clipboard fallback" });
  await hui.open(`/sessions/${session.id}`);
  await screen.getByLabel("Message").fill("Fallback copy");
  await screen.getByRole("button", "Send message").tap();
  const transcript = screen.getByTestId("transcript");
  const copy = transcript.getByRole("button", "Copy response").first();
  await expect(copy).toBeVisible();
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();
  await copy.tap();
  await expect(transcript.getByRole("button", "Copied")).toBeVisible();
  await expect.poll(() => hui.copied()).toBe("Fixture response.");
});
