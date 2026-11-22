/** A manual compaction runs beside a Durable conversation: cancel it, or keep working and watch it land (CHAT-037). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("a Durable session compacts beside the conversation: Cancel compaction ends it with no marker, and the next one lands as Context compacted", { tags: ["CHAT-037"], platforms: ["web"] }, async ({ screen, hui }) => {
  const message = screen.getByLabel("Message", { visible: true });
  const send = screen.getByRole("button", "Send message", { visible: true });
  const transcript = screen.getByTestId("transcript", { visible: true });
  const idle = screen.getByLabel("Session status: Idle", { visible: true });
  const compaction = screen.getByLabel("Compacting context…", { visible: true });
  const compacted = screen.getByLabel(/^Context compacted, from \S+ tokens$/u);
  const ring = screen.getByLabel(/^Context window: \d+% used$/u);
  const usage = screen.getByLabel("Context usage");

  const session = await hui.createSession({ title: "Compaction beside the chat" });
  await hui.open(`/sessions/${session.id}`);
  await expect(idle).toBeVisible();
  // The summarizer request is the one the fixture holds, so the divider can be read while it runs.
  await message.fill("E2E_SLOW_COMPACT keep this turn");
  await send.tap();
  await expect(transcript.getByText("Fixture response.")).toBeVisible();
  await expect(idle).toBeVisible();

  // A manual compaction leaves the session idle and free: it names itself, offers its own cancel, and the chat answers on.
  await message.fill("/compact keep the API decisions");
  await send.tap();
  await hui.provider.held();
  await expect(compaction).toBeVisible();
  await expect(screen.getByRole("button", "Cancel compaction")).toBeVisible();
  await expect(idle).toBeVisible();
  await expect(screen.getByRole("button", "Stop")).toBeHidden();
  await ring.tap();
  await expect(usage.getByRole("button", "Compact now")).toBeDisabled();
  await ring.tap();
  await message.fill("Answered while compacting");
  await send.tap();
  await expect(transcript.getByText("Answered while compacting")).toBeVisible();
  await expect(transcript.getByText("Fixture response.")).toHaveCount(2);
  await expect(compaction).toBeVisible();
  await expect(idle).toBeVisible();

  await screen.getByRole("button", "Cancel compaction").tap();
  await expect(screen.getByLabel("Compaction cancelled", { visible: true })).toBeVisible();
  await expect(compacted).toHaveCount(0);
  await expect(idle).toBeVisible();

  // The next compaction is left alone: it lands as the transcript's own marker, above every turn it kept.
  await message.fill("/compact");
  await send.tap();
  await hui.provider.held();
  await expect(compaction).toBeVisible();
  await hui.provider.release();
  await expect(compacted).toBeVisible();
  await expect(idle).toBeVisible();
  await expect(transcript.getByText("/compact", { exact: true })).toHaveCount(0);
  await transcript.getByText("Show summary").tap();
  await expect(transcript.getByText("FIXTURE_SUMMARY")).toBeVisible();
});
