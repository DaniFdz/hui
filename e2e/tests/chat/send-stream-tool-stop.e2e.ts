/** Sending a prompt streams the reply, a read tool card opens to its output, and Stop ends a run (CHAT-001, CHAT-025, CHAT-004). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("a reply streams, its tool card opens, and Stop ends the next run", { tags: ["CHAT-001", "CHAT-025", "CHAT-004", "smoke"], platforms: ["web"] }, async ({ app, screen, hui }) => {
  const message = screen.getByLabel("Message");
  const send = screen.getByRole("button", "Send message");
  const status = (value: string) => screen.getByLabel(`Session status: ${value}`);
  const transcript = screen.getByTestId("transcript");

  const session = await hui.createSession({ title: "Stream and stop" });
  await hui.open(`/sessions/${session.id}`);
  await expect(status("Idle")).toBeVisible();

  await message.fill("E2E_REPLAY");
  await send.tap();
  await expect(status("Running")).toBeVisible();
  await hui.provider.held();
  await expect(transcript.getByText("Replay prefix —", { exact: false })).toBeVisible();
  await expect(transcript.getByText("replay suffix", { exact: false })).toBeHidden();
  await hui.provider.release();
  await expect(transcript.getByText("Replay prefix — replay suffix")).toBeVisible();
  await expect(status("Idle")).toBeVisible();

  await message.fill("E2E_RICH");
  await send.tap();
  await expect(transcript.getByText("Tool complete")).toBeVisible();
  await expect(status("Idle")).toBeVisible();
  await transcript.getByText("Used 1 tool").tap();
  await transcript.getByRole("button", "Read fixture.txt").tap();
  await expect(transcript.getByText("Inspecting the fixture.")).toBeVisible();
  await expect(transcript.getByText(/^from .+\/fixture\.txt$/u)).toBeVisible();
  await expect(transcript.getByText("Real SDK browser fixture", { exact: false })).toBeVisible();
  await expect(transcript.getByText("Completed")).toBeVisible();
  await app.screenshot("tool-card-open");

  await message.fill("E2E_ABORT");
  await send.tap();
  await expect(transcript.getByText("Abort prefix", { exact: false })).toBeVisible();
  await expect(send).toBeHidden();
  await screen.getByRole("button", "Stop").tap();
  await expect(status("Idle")).toBeVisible();
  await expect(screen.getByRole("button", "Stop")).toBeHidden();
  await message.fill("Still there?");
  await send.tap();
  await expect(transcript.getByText("Fixture response.")).toBeVisible();
});
