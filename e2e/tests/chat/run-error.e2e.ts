/** A run that ends on a provider error keeps the error in its folded activity and shows a card above the composer to copy, dismiss or continue from (CHAT-020). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("a failed run's error card copies the error, comes back after a dismiss and a reload, and Continue resumes the chat", { tags: ["CHAT-020"], platforms: ["web"] }, async ({ screen, hui }) => {
  const transcript = screen.getByTestId("transcript");
  const idle = screen.getByLabel("Session status: Idle");
  const summary = screen.getByText(/^400 .*fixture provider error: the fixture refuses this request on purpose.*…$/u);
  const continueRun = screen.getByRole("button", "Continue", { exact: true });

  await hui.clipboard();
  const session = await hui.createSession({ title: "Run error" });
  await hui.open(`/sessions/${session.id}`);
  await expect(idle).toBeVisible();
  await screen.getByLabel("Message").fill("E2E_ERROR_LONG");
  await screen.getByRole("button", "Send message").tap();
  await expect(summary).toBeVisible();
  await expect(idle).toBeVisible();
  const card = await summary.boundingBox();
  const composer = await screen.getByLabel("Message").boundingBox();
  expect(card && composer && card.y + card.height <= composer.y).toBe(true);
  await expect(screen.getByRole("button", "Copy error")).toBeVisible();
  await expect(continueRun).toBeVisible();
  await expect(transcript.getByText("see the fixture for why", { exact: false })).toBeHidden();
  await transcript.getByText("Run details").tap();
  await expect(transcript.getByText("see the fixture for why", { exact: false })).toBeVisible();

  await screen.getByText("Details", { exact: true }).tap();
  await expect(screen.getByLabel("Error details")).toContainText("on purpose; see the fixture for why");
  await screen.getByRole("button", "Copy error").tap();
  await expect.poll(() => hui.copied()).toMatch(/^400 .*fixture provider error: .*see the fixture for why/u);

  await screen.getByRole("button", "Dismiss error").tap();
  await expect(summary).toBeHidden();
  await hui.reload();
  await expect(summary).toBeVisible();
  await transcript.getByText("Run details").tap();
  await expect(transcript.getByText("see the fixture for why", { exact: false })).toBeVisible();

  await continueRun.tap();
  await expect(transcript.getByText("Continue from where you left off.")).toBeVisible();
  await expect(transcript.getByText("Fixture response.")).toBeVisible();
  await expect(summary).toBeHidden();
  await expect(idle).toBeVisible();
  await hui.reload();
  await expect(transcript.getByText("Fixture response.")).toBeVisible();
  await expect(summary).toBeHidden();
});
