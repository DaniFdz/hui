/** A run cut off by a gateway restart carries on by itself, and a chat left running gets an unread mark when it settles that outlives a restart (CHAT-018, CHAT-017). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("a run cut off by a gateway restart carries on without manual action, on Pi Durable and on PI's worker", { tags: ["CHAT-018"], platforms: ["web"] }, async ({ screen, hui }) => {
  const transcript = screen.getByTestId("transcript", { visible: true });
  const status = (value: string) => screen.getByLabel(`Session status: ${value}`, { visible: true });
  const recovery = transcript.getByText(/^The previous run was interrupted while handling this request:\s+E2E_REPLAY\s+Review the latest transcript and workspace state/u);
  const cutOff = async (session: { id: string }) => {
    await hui.open(`/sessions/${session.id}`);
    await expect(status("Idle")).toBeVisible();
    await screen.getByLabel("Message").fill("E2E_REPLAY");
    await screen.getByRole("button", "Send message").tap();
    await hui.provider.held();
    await expect(transcript.getByText("Replay prefix —", { exact: false })).toBeVisible();
    await hui.restartGateway();
    await hui.provider.held();
    await expect(status("Running")).toBeVisible();
  };

  await cutOff(await hui.createSession({ title: "Durable restart" }));
  await hui.provider.release();
  await expect(transcript.getByText("Replay prefix — replay suffix")).toBeVisible();
  await expect(status("Idle")).toBeVisible();
  await expect(recovery).toBeHidden();

  await cutOff(await hui.createSession({ title: "Worker restart", tool: "pi" }));
  await expect(recovery).toBeVisible();
  await hui.provider.release();
  await expect(transcript.getByText("Replay prefix — replay suffix")).toBeVisible();
  await expect(status("Idle")).toBeVisible();
});
