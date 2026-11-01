/** Reloading or reopening a chat while its turn streams shows Running and the text so far, and the reply ends with one copy of the text (CHAT-015). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("a chat reloaded or reopened mid-turn shows the reply so far, and the reply finishes exactly once", { tags: ["CHAT-015"] }, async ({ screen, hui }) => {
  const transcript = screen.getByTestId("transcript", { visible: true });
  const status = (value: string) => screen.getByLabel(`Session status: ${value}`, { visible: true });
  const row = (title: string) => screen.getByLabel(new RegExp(`^${title}, status `, "u"));
  const prefix = transcript.getByText("Replay prefix —", { exact: false });

  const session = await hui.createSession({ title: "Reload mid-turn" });
  await hui.createSession({ title: "Elsewhere" });
  await hui.open(`/sessions/${session.id}`);
  await expect(status("Idle")).toBeVisible();
  await screen.getByLabel("Message").fill("E2E_REPLAY");
  await screen.getByRole("button", "Send message").tap();
  await hui.provider.held();
  await expect(prefix).toBeVisible();

  await hui.reload();
  await expect(status("Running")).toBeVisible();
  await expect(prefix).toBeVisible();
  await expect(transcript.getByText("replay suffix", { exact: false })).toBeHidden();

  await hui.sessionList();
  await row("Elsewhere").tap();
  await expect(status("Idle")).toBeVisible();
  await expect(prefix).toBeHidden();
  await hui.sessionList();
  await row("Reload mid-turn").tap();
  await expect(status("Running")).toBeVisible();
  await expect(prefix).toBeVisible();

  await hui.provider.release();
  await expect(transcript.getByText("Replay prefix — replay suffix")).toBeVisible();
  await expect(status("Idle")).toBeVisible();
  await expect(prefix).toHaveCount(1);
});
