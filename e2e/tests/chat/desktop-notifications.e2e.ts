/** The notification tool is off until Settings → Tools turns it on (SET-077), and an unavailable native notification
 * is a visible failed tool call, never an invented delivery receipt (AGENT-060). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("the notification tool waits for Settings, then fails explicitly without a managed macOS gateway", { tags: ["AGENT-060", "SET-077"], platforms: ["web"] }, async ({ screen, hui }) => {
  const session = await hui.createSession({ title: "Notification unavailable" });
  const transcript = screen.getByTestId("transcript");
  const call = `E2E_CALL:${Buffer.from(JSON.stringify({ name: "notify_user", input: { title: "Ready", message: "Open this chat." } })).toString("base64url")}`;
  const send = async () => {
    await expect(screen.getByLabel("Session status: Idle")).toBeVisible();
    await screen.getByLabel("Message").fill(call);
    await screen.getByRole("button", "Send message").tap();
  };

  await hui.open(`/sessions/${session.id}`);
  await send();
  await expect(transcript.getByText(/^tool answered:.*notify_user/su)).toBeVisible();
  await expect(transcript.getByText(/^tool answered:.*(?:macOS gateway|managed HUI gateway)/su)).toBeHidden();

  await hui.open("/settings/tools");
  const tool = screen.getByRole("switch", "Notification tool");
  await expect(tool).toBeChecked({ checked: false });
  await tool.tap({ position: { x: 8, y: 8 } });
  await expect.poll(async () => (await hui.api<{ notifications: { tool: boolean } }>("GET", "/__hui/settings")).notifications.tool).toBe(true);

  await hui.open(`/sessions/${session.id}`);
  await send();
  await expect(transcript.getByText(/^tool answered:.*(?:macOS gateway|managed HUI gateway)/su)).toBeVisible();
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();
  await expect(transcript.getByText(/"status":\s*"queued"/u)).toBeHidden();
});
