/** A read's row says it is reading while the call runs and that it read the file once it ends (CHAT-067). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("a read tool call's row says Running while it runs and Completed when the call ends", { tags: ["CHAT-067"] }, async ({ screen, hui }) => {
  const transcript = screen.getByTestId("transcript");
  const idle = screen.getByLabel("Session status: Idle");
  const session = await hui.createSession({ title: "A read in flight" });
  await hui.open(`/sessions/${session.id}`);
  await expect(idle).toBeVisible();

  // PI's own read cannot be paused mid-execution, so the call held here is the fixture's read tool: the same row, the
  // same card body and the same status the transcript draws for PI's read.
  const running = await hui.holdTool(session, "read_file", { path: "notes.txt" });
  const group = transcript.getByText("Using 1 tool");
  await hui.scrollTo(transcript, group);
  const row = transcript.getByRole("button", /^Reading notes\.txt/u);
  if (!(await row.isVisible())) await group.tap();
  await expect(row).toBeVisible();
  await row.tap();
  await expect(transcript.getByText("Running", { exact: true })).toBeVisible();

  await running.release();
  await expect(idle).toBeVisible();
  await expect(transcript.getByRole("button", /^Read notes\.txt/u)).toBeVisible();
  await expect(transcript.getByText("Completed", { exact: true })).toBeVisible();
});
