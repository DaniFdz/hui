/** The path a read, edit or write tool card names is a link that opens that file in the conversation's Files view
 * (WORK-060). */
import { join } from "node:path";
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

/** The activity trail a turn's stretch folds into: today's wording, or the count wording an older iOS build shows. */
const trail = /^(?:Work(?:ing|ed) for .*|Us(?:ing|ed) \d+ tools?(?: · .*)?|Reasoning|Thinking…)$/u;

/** Tool calls the fixture provider asks HUI to run in one answer, the way the model would. */
const calls = (list: { name: string; input: Record<string, unknown> }[]) => `E2E_CALL:${Buffer.from(JSON.stringify(list)).toString("base64url")}`;

test("the path header of a read, edit or write tool card is a link that opens that file in Files", { tags: ["WORK-060"], platforms: ["web"] }, async ({ screen, hui }) => {
  const repository = await hui.repository();
  const keep = join(repository.path, "sub", "keep.txt");
  const written = join(repository.path, "sub", "written.txt");
  const session = await hui.createSession({ title: "Tool card paths", cwd: repository.path });
  const transcript = screen.getByTestId("transcript");

  await hui.open(`/sessions/${session.id}`);
  await hui.prompt(session, calls([
    { name: "read", input: { path: keep } },
    { name: "edit", input: { path: keep, edits: [{ oldText: "sub", newText: "sub edited" }] } },
    { name: "write", input: { path: written, content: "written by the agent\n" } },
  ]));
  await expect.poll(() => hui.textOf(transcript)).toContain("tool answered:");

  await hui.scrollTo(transcript, transcript.getByText(trail).first());
  if (await transcript.getByRole("button", /^Read keep\.txt/u).count() === 0) await transcript.getByText(trail).first().tap();
  for (const row of [/^Read keep\.txt/u, /^Edited keep\.txt/u, /^Wrote written\.txt/u]) {
    const card = transcript.getByRole("button", row);
    await hui.scrollTo(transcript, card);
    await card.tap();
  }

  // Each card's own header names its file as a link to that file in Files, and so does the chip the trail's summary
  // carries for it: the fold says what it touched while it is closed, so `keep.txt` is drawn once there for the two
  // calls that named it, and `written.txt` once for its one write.
  await expect(transcript.getByRole("link", "Open sub/keep.txt in Files")).toHaveCount(3);
  await expect(transcript.getByRole("link", "Open sub/written.txt in Files")).toHaveCount(2);

  await transcript.getByRole("link", "Open sub/written.txt in Files").last().tap();
  await expect(screen.getByLabel(/Contents of .*sub\/written\.txt/u)).toHaveText(/written by the agent/u);
  await expect(screen.getByLabel("Work pane").getByRole("tab", "written.txt")).toBeVisible();
});
