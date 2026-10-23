/** An unavailable native notification is a visible failed tool call, never an invented delivery receipt (AGENT-060). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("desktop notifications fail explicitly when the fixture has no managed macOS gateway", { tags: ["AGENT-060"], platforms: ["web"] }, async ({ screen, hui }) => {
  const session = await hui.createSession({ title: "Notification unavailable" });
  await hui.open(`/sessions/${session.id}`);
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();
  const call = Buffer.from(JSON.stringify({ name: "notify_user", input: { title: "Ready", message: "Open this chat." } })).toString("base64url");
  await screen.getByLabel("Message").fill(`E2E_CALL:${call}`);
  await screen.getByRole("button", "Send message").tap();
  const transcript = screen.getByTestId("transcript");
  await expect(transcript.getByText(/^tool answered:.*(?:macOS gateway|managed HUI gateway)/su)).toBeVisible();
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();
  await expect(transcript.getByText(/"status":\s*"queued"/u)).toBeHidden();
});
