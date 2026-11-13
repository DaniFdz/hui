/** Escape inside the Work pane returns focus to the chat composer and leaves the running turn alone (WORK-015). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("Escape in the Work pane returns focus to the chat composer and leaves the turn running", { tags: ["WORK-015"], platforms: ["web"] }, async ({ screen, hui }) => {
  const message = screen.getByLabel("Message");
  const pane = screen.getByLabel("Work pane");
  const transcript = screen.getByTestId("transcript");
  const session = await hui.createSession({ title: "Escape the Work pane" });

  await hui.wideScreen();
  await hui.open(`/sessions/${session.id}`);
  await message.fill("E2E_COMMAND_RUNNING");
  await screen.getByRole("button", "Send message").tap();
  await hui.provider.held();
  await expect(transcript.getByText("Using 1 tool")).toBeVisible();

  await screen.getByRole("button", "Show Work pane").tap();
  await pane.getByRole("button", { name: /^New terminal/u }).tap();
  const terminal = pane.getByRole("tab", "Terminal 1");
  await expect(terminal).toBeVisible();
  // Startup takes keyboard focus before connecting the terminal. Wait for that real readiness before pressing Escape
  // on the pane's tab: a cold renderer must not move the key into the terminal, where Escape belongs to the shell.
  await expect(pane.getByRole("status").getByText("Shared · Connected", { exact: true })).toBeVisible();
  await terminal.press("Escape");
  await expect(message).toBeFocused();
  await expect(transcript.getByText("Using 1 tool")).toBeVisible();

  await hui.provider.release();
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();
});
