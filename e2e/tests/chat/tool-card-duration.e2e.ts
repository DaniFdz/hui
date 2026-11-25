/** A finished tool card shows how long the call itself took, worded like the timings on a message's footer (CHAT-033).
 * The duration is the gateway's own measurement of the tool, which PI's worker reports per call and a call it did not
 * time leaves absent, so this runs on the PI worker (`tool: "pi"`) the repository keeps as its fallback. */
import { join } from "node:path";
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

/** A tool call the fixture provider asks HUI to run in one answer, the way the model would. */
const call = (name: string, input: Record<string, unknown>) => `E2E_CALL:${Buffer.from(JSON.stringify({ name, input })).toString("base64url")}`;
const duration = /^(?:Completed|failed) in \d+ (?:ms|s|m \d+s)$/u;

test("a finished read card shows how long the read took", { tags: ["CHAT-033"], platforms: ["web"] }, async ({ screen, hui }) => {
  const repository = await hui.repository();
  const transcript = screen.getByTestId("transcript");
  const session = await hui.createSession({ title: "Tool card durations", cwd: repository.path, tool: "pi" });

  await hui.open(`/sessions/${session.id}`);
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();
  await hui.prompt(session, call("read", { path: join(repository.path, "sub", "keep.txt") }));
  await expect.poll(() => hui.textOf(transcript)).toContain("tool answered:");

  // The read card is closed behind the group until the operator opens it, then opens to its own duration.
  const group = transcript.getByText("Used 1 tool");
  await hui.scrollTo(transcript, group);
  const row = transcript.getByRole("button", /^Read keep\.txt/u);
  if (!(await row.isVisible())) await group.tap();
  await hui.scrollTo(transcript, row);
  await row.tap();
  await expect(transcript.getByText(duration)).toBeVisible();
});

test("a finished command card shows how long the command took", { tags: ["CHAT-033"], platforms: ["web"] }, async ({ screen, hui }) => {
  const repository = await hui.repository();
  const transcript = screen.getByTestId("transcript");
  const session = await hui.createSession({ title: "Command card durations", cwd: repository.path, tool: "pi" });

  await hui.open(`/sessions/${session.id}`);
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();
  await hui.prompt(session, call("bash", { command: "printf 'timed command\\n'" }));
  await expect.poll(() => hui.textOf(transcript)).toContain("tool answered:");

  const group = transcript.getByText("Used 1 tool");
  await hui.scrollTo(transcript, group);
  const row = transcript.getByRole("button", /^Ran printf/u);
  if (!(await row.isVisible())) await group.tap();
  await hui.scrollTo(transcript, row);
  await row.tap();
  await expect(transcript.getByText(duration)).toBeVisible();
});
