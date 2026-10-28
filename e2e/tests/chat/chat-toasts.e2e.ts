/** A failed chat action says so in the shell's toast, in the top trailing corner, and repeats when it fails again (CHAT-021). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

const REWIND = /\/__hui\/sessions\/[^/]+\/rewind$/u;
const REASON = "The branch could not be rewound.";

test("a rejected chat action shows its reason in the toast, which dismisses and repeats", { tags: ["CHAT-021"], platforms: ["web"] }, async ({ screen, hui }) => {
  const transcript = screen.getByTestId("transcript");
  const rewind = transcript.getByRole("button", "Rewind to here").last();
  const session = await hui.createSession({ title: "Failed chat action" });
  await hui.open(`/sessions/${session.id}`);
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();
  await screen.getByLabel("Message").fill("Send me a branch");
  await screen.getByRole("button", "Send message").tap();
  await expect(transcript.getByText("Fixture response.")).toBeVisible();
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();
  await hui.wideScreen();

  const failed = await hui.intercept("POST", REWIND);
  await rewind.tap();
  await failed.arrived();
  await failed.reject(503, REASON);
  const toast = screen.getByText(REASON);
  await expect(toast).toBeVisible();
  const box = (await toast.boundingBox())!;
  const pane = (await transcript.boundingBox())!;
  const title = (await screen.getByTestId("session-title").boundingBox())!;
  expect(box.y).toBeGreaterThan(title.y);
  expect(box.x).toBeGreaterThan(pane.x + pane.width / 2);
  expect(Math.abs(box.x + box.width - (pane.x + pane.width))).toBeLessThan(40);
  await expect(transcript.getByText(REASON)).toHaveCount(0);

  await screen.getByRole("button", "Dismiss notification").tap();
  await expect(toast).toBeHidden();

  const phone = await hui.phoneScreen();
  const again = await hui.intercept("POST", REWIND);
  await rewind.tap();
  await again.arrived();
  await again.reject(503, REASON);
  await expect(toast).toBeVisible();
  expect((await toast.boundingBox())!.y).toBeGreaterThan((await screen.getByTestId("session-title").boundingBox())!.y);
  const shown = (await toast.boundingBox())!;
  expect(shown.x).toBeGreaterThanOrEqual(0);
  expect(shown.y).toBeGreaterThanOrEqual(0);
  expect(shown.x + shown.width).toBeLessThanOrEqual(phone.width);
  expect(shown.y + shown.height).toBeLessThanOrEqual(phone.height);
  await expect(transcript.getByText(REASON)).toHaveCount(0);
});
