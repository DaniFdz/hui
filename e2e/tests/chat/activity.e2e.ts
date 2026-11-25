/** A turn's activity folds between the messages the agent writes, one trail per stretch, and opens in order (CHAT-023,
 * CHAT-024). Its header reads the trail's own wording on today's page and the count wording an older iOS build of the
 * same page shows, so the disclosure is found on every target. */
import { expect, type Locator } from "e2e";
import { test } from "../../fixtures/hui.ts";

const inOrder = async (...items: Locator[]) => {
  const tops: number[] = [];
  for (const item of items) {
    await expect(item).toBeVisible();
    tops.push((await item.boundingBox())!.y);
  }
  expect(tops).toEqual([...tops].sort((a, b) => a - b));
};

/** The activity trail's summary, in today's wording and in the count wording an older iOS build draws. */
const trail = /^(?:Work(?:ing|ed) for .*|Us(?:ing|ed) \d+ tools?(?: · .*)?|Reasoning|Thinking…)$/u;

const call = (verb: "CALL" | "HOLD", calls: { name: string; input: Record<string, unknown> }[]) =>
  `E2E_${verb}:${Buffer.from(JSON.stringify(calls)).toString("base64url")}`;

test("a message written mid-turn keeps its own row with its links, live and after a reload", { tags: ["CHAT-024"] }, async ({ screen, hui }) => {
  const transcript = screen.getByTestId("transcript");
  const session = await hui.createSession({ title: "Mid-turn message" });
  await hui.open(`/sessions/${session.id}`);
  await screen.getByLabel("Message").fill("E2E_MIDTURN_MESSAGE");
  await screen.getByRole("button", "Send message").tap();
  await expect(transcript.getByText("Started two helpers in the background; I'll report when they're back.")).toBeVisible();
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();

  for (const pass of ["live", "reloaded"]) {
    if (pass === "reloaded") await hui.reload();
    await expect(transcript.getByText("What to check for the checkout alert")).toBeVisible();
    await hui.expectLinkTo(transcript, "service dashboard", "https://example.com/dashboard/checkout");
    await hui.expectLinkTo(transcript, "error logs", "https://example.com/logs?query=status%3Aerror");
    await expect(transcript.getByText("Started two helpers in the background; I'll report when they're back.")).toBeVisible();
    await hui.scrollTo(transcript, transcript.getByText(trail));
    const read = transcript.getByRole("button", /^Read fixture\.txt/u);
    if (!(await read.isVisible())) await transcript.getByText(trail).tap();
    await expect(read).toBeVisible();
  }
});

test("each stretch of activity folds under one trail that opens in order", { tags: ["CHAT-023"] }, async ({ screen, hui }) => {
  const message = screen.getByLabel("Message");
  const send = screen.getByRole("button", "Send message");
  const transcript = screen.getByTestId("transcript");
  const idle = screen.getByLabel("Session status: Idle");
  const session = await hui.createSession({ title: "Folded activity" });
  await hui.open(`/sessions/${session.id}`);
  await expect(idle).toBeVisible();

  // Reasoning alone is one stretch and one disclosure, never two, and its header is found by the shared trail regex:
  // once it measured a span it reads the clock rather than the word Reasoning.
  await message.fill("E2E_THINKING");
  await send.tap();
  await expect(transcript.getByText("Thought it through.")).toBeVisible();
  await expect(idle).toBeVisible();
  const thinkingTrail = transcript.getByText(trail);
  await expect(thinkingTrail).toHaveCount(1);
  await hui.scrollTo(transcript, thinkingTrail);
  await thinkingTrail.tap();
  await expect(transcript.getByText("Weighing the fixture.")).toBeVisible();

  // The turn this composer send started counts from that moment, so the held call reads the clock, never only a count.
  await message.fill(call("HOLD", [{ name: "fixture_echo", input: { text: "live" } }]));
  await send.tap();
  await hui.provider.held();
  await expect(transcript.getByText(/^Working for \d+s · 1 other call$/u)).toBeVisible();
  await hui.provider.release();
  await expect(idle).toBeVisible();
  await expect(transcript.getByText(/^Worked for \d+s · 1 other call$/u)).toBeVisible();

  await message.fill("E2E_RICH");
  await send.tap();
  await expect(transcript.getByText("Tool complete")).toBeVisible();
  await expect(idle).toBeVisible();
  // The reasoning and the call it shares a row with open together, from the one summary.
  await hui.scrollTo(transcript, transcript.getByText(/^Worked for \d+s · 1 read$/u).last());
  const reasoning = transcript.getByText(/^Worked for \d+s · 1 read$/u).last();
  const read = transcript.getByRole("button", /^Read fixture\.txt/u);
  if (!(await read.isVisible())) await reasoning.tap();
  await inOrder(transcript.getByText("Inspecting the fixture."), read);

  await message.fill(call("CALL", [
    { name: "read", input: { path: `${hui.workspace}/fixture.txt` } },
    { name: "bash", input: { command: "echo folded" } },
    { name: "edit", input: { path: `${hui.workspace}/missing.txt`, edits: [{ oldText: "before", newText: "after" }] } },
  ]));
  await send.tap();
  await expect(idle).toBeVisible();
  const calls = transcript.getByText(/^Worked for \d+s · 1 edit, 1 read, 1 run$/u).last();
  await hui.scrollTo(transcript, calls);
  const ranEcho = transcript.getByRole("button", /^Ran echo folded/u);
  if (!(await ranEcho.isVisible())) await calls.tap();
  await inOrder(transcript.getByRole("button", /^Read fixture\.txt/u).last(), ranEcho, transcript.getByRole("button", /^Edited missing\.txt/u));
  await hui.scrollTo(transcript, transcript.getByText("Weighing the fixture."));
  await expect(transcript.getByText("Weighing the fixture.")).toBeVisible();
});
