/** A failed chat action shows its error in a toast at the top trailing corner, below the header and inside a phone's screen, which Dismiss notification closes and the next failure brings back (CHAT-021). */
import { expect, type Locator } from "e2e";
import { test } from "../../fixtures/hui.ts";

const REFUSAL = "Rewind to a user message or completed tool result before continuing.";

test("a rejected Continue and a failed copy show their errors as toasts below the header that Dismiss notification closes", { tags: ["CHAT-021"], platforms: ["web"] }, async ({ screen, hui }) => {
  const transcript = screen.getByTestId("transcript");
  const idle = screen.getByLabel("Session status: Idle");
  const toast = screen.getByText(REFUSAL);
  const dismiss = screen.getByRole("button", "Dismiss notification");
  const box = async (target: Locator) => {
    const found = await target.boundingBox();
    if (!found) throw new Error("the target lays out no box");
    return found;
  };
  const refuseContinue = async () => {
    const resume = await hui.intercept("POST", /\/__hui\/sessions\/[^/]+\/resume$/u);
    await screen.getByRole("button", "Continue without a prompt").tap();
    await resume.reject(409, REFUSAL);
    await expect(toast).toBeVisible();
  };
  const belowHeaderAtTheTop = async (headerControl: Locator, width: number, height: number, trailing: boolean) => {
    const shown = await box(toast);
    const header = await box(headerControl);
    expect(shown.y).toBeGreaterThanOrEqual(header.y + header.height);
    expect(shown.y).toBeLessThan(height / 4);
    expect(shown.x).toBeGreaterThanOrEqual(0);
    expect(shown.x + shown.width).toBeLessThanOrEqual(width);
    if (trailing) expect(shown.x).toBeGreaterThan(width / 2);
  };

  await hui.clipboard({ refuse: true });
  const session = await hui.createSession({ title: "Action toast", tool: "pi" });
  await hui.open(`/sessions/${session.id}`);
  await expect(idle).toBeVisible();
  await screen.getByLabel("Message").fill("Hello");
  await screen.getByRole("button", "Send message").tap();
  await expect(transcript.getByText("Fixture response.")).toBeVisible();
  await expect(idle).toBeVisible();

  await refuseContinue();
  await belowHeaderAtTheTop(idle, 1440, 900, true);
  await dismiss.tap();
  await expect(toast).toBeHidden();
  await refuseContinue();
  await dismiss.tap();
  await expect(toast).toBeHidden();

  const phone = await hui.phoneScreen();
  await refuseContinue();
  await belowHeaderAtTheTop(screen.getByLabel(/^Active panel: /u), phone.width, phone.height, false);
  await dismiss.tap();
  await expect(toast).toBeHidden();

  await transcript.getByRole("button", "Copy prompt").tap();
  await expect(screen.getByText("Could not copy to the clipboard.")).toBeVisible();
  await dismiss.tap();
  await expect(screen.getByText("Could not copy to the clipboard.")).toBeHidden();
});
