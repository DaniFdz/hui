/**
 * The fixture's own capability checks: the steps `hui.ts` gained so an area's use cases can be written, proven here
 * rather than in `e2e/tests/**`, because they describe what the fixture can drive and not a use case of its own. Run
 * them with `npx e2e run --target web e2e/fixtures`, which the suite's own glob (`e2e/tests/**`) leaves out.
 *
 * `holdTool` holds one tool call of a name a test chooses, so a row's state and the working indicator can be read while
 * the call runs: that is what CHAT-067 and CHAT-075 need. `openSubagent` opens a child's own conversation from the card
 * its parent's chat draws, which SET-078 and SET-079 read a child's header from.
 */
import { expect } from "e2e";
import { test } from "./hui.ts";

test("hui.holdTool holds a tool call of a chosen name so its row and the working indicator can be read in flight", { platforms: ["web"] }, async ({ screen, hui }) => {
  const transcript = screen.getByTestId("transcript");
  const idle = screen.getByLabel("Session status: Idle");
  const session = await hui.createSession({ title: "Held tools" });
  await hui.open(`/sessions/${session.id}`);
  await expect(idle).toBeVisible();

  // The three names HUI's working indicator maps to a step of its own, each from the class the label names.
  const held = [
    { name: "read_file", input: { path: "notes.txt" }, indicator: "Reading files…", row: "Reading notes.txt", done: "Read notes.txt" },
    { name: "apply_patch", input: { path: "notes.txt" }, indicator: "Editing files…", row: "Editing notes.txt", done: "Edited notes.txt" },
    { name: "git_status", input: {}, indicator: "Checking git…", row: "Using git status", done: "Used git status" },
  ] as const;
  for (const call of held) {
    const running = await hui.holdTool(session, call.name, call.input);
    await expect(screen.getByLabel(`Agent activity: ${call.indicator}`)).toBeVisible();
    const group = transcript.getByText("Using 1 tool");
    await hui.scrollTo(transcript, group);
    const row = transcript.getByRole("button", new RegExp(`^${call.row}`, "u"));
    if (!(await row.isVisible())) await group.tap();
    await expect(row).toBeVisible();
    await running.release();
    await expect(idle).toBeVisible();
    await expect(transcript.getByRole("button", new RegExp(`^${call.done}`, "u"))).toBeVisible();
  }
});

test("hui.openSubagent opens a child's own conversation from the card its parent's chat draws", { platforms: ["web"] }, async ({ screen, hui }) => {
  const parent = await hui.createSession({ title: "Subagent parent" });
  const child = await hui.createSubagent(parent);
  await hui.open(`/sessions/${parent.id}`);
  await expect(screen.getByLabel("Parallel tasks")).toBeVisible();

  await hui.openSubagent(child);
  await expect.poll(() => hui.url()).toContain(child.id);
  await expect(screen.getByTestId("chat-header").getByRole("heading", { name: child.title })).toBeVisible();
});
