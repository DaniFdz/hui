/** A live turn's activity trail counts its own clock from the composer's send, marks a failed call while still
 * collapsed, and opens the file, pull-request and session chips its calls proved (CHAT-099). A second prompt after a
 * trail holding a session chip is the regression for the transcript freezing: the chip writes its own text, so Lit owns
 * no part of it and a re-render still draws. */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

const call = (verb: "CALL" | "HOLD", calls: { name: string; input: Record<string, unknown> }[]) =>
  `E2E_${verb}:${Buffer.from(JSON.stringify(calls)).toString("base64url")}`;

test("a turn's activity trail times the turn, marks a failure and opens its chips", { tags: ["CHAT-099"], platforms: ["web"] }, async ({ screen, hui }) => {
  const transcript = screen.getByTestId("transcript");
  const message = screen.getByLabel("Message");
  const send = screen.getByRole("button", "Send message");
  const idle = screen.getByLabel("Session status: Idle");
  // The chip needs a session the registry knows by its own id.
  const referenced = await hui.createSession({ title: "Referenced session" });
  const session = await hui.createSession({ title: "Activity trail" });
  await hui.open(`/sessions/${session.id}`);
  await expect(idle).toBeVisible();

  // A turn the composer's own Send button starts counts from that moment, one second at a time and with no reload:
  // the trail is a clock, never only a count of the calls.
  await message.fill(call("HOLD", [{ name: "fixture_echo", input: { text: "held" } }]));
  await send.tap();
  await hui.provider.held();
  const live = transcript.getByText(/^Working for \d+s · 1 other call$/u);
  await expect(live).toBeVisible();
  const first = await live.textContent();
  await expect.poll(async () => (await live.textContent()) !== first, {
    timeout: 15_000,
    message: "the live trail's clock never advanced past its first reading",
  }).toBe(true);
  await hui.provider.release();
  await expect(idle).toBeVisible();
  await expect(transcript.getByText(/^Worked for \d+s · 1 other call$/u)).toBeVisible();

  // One element per stretch, from the summary this test taps to the body its chips live in.
  const trails = transcript.getByTestId("activity-trail-group");
  const summaries = transcript.getByTestId("activity-trail");

  // Reasoning and the call it shares a stretch with open together from the one summary.
  await hui.prompt(session, "E2E_RICH");
  await expect(idle).toBeVisible();
  await expect(trails).toHaveCount(2);
  const rich = trails.nth(1);
  // Folded, a trail is its summary alone: no call row is drawn until the reader opens it.
  await expect(rich.getByRole("button", /^Read fixture\.txt/u)).toHaveCount(0);
  await summaries.nth(1).tap();
  await expect(rich.getByText("Inspecting the fixture.")).toBeVisible();
  await expect(rich.getByRole("button", /^Read fixture\.txt/u)).toBeVisible();
  await expect(rich.getByRole("link", { name: /^Open .*fixture\.txt in Files$/u })).toBeVisible();

  // A failed edit marks the collapsed header, and the calls' own data draws their chips.
  await hui.prompt(session, call("CALL", [
    { name: "read", input: { path: `${hui.workspace}/fixture.txt` } },
    { name: "bash", input: { command: `echo https://github.com/DaniFdz/HUI/pull/580 && echo session:${referenced.id}` } },
    { name: "edit", input: { path: `${hui.workspace}/missing.txt`, edits: [{ oldText: "before", newText: "after" }] } },
  ]));
  await expect(idle).toBeVisible();
  // One trail per stretch: three turns, three disclosures, and never a second fold beside one.
  await expect(trails).toHaveCount(3);
  const last = trails.nth(2);
  await expect(last.getByTestId("activity-trail")).toContainText(/^Worked for \d+s · 1 edit, 1 read, 1 run/u);
  await expect(last.getByText("failed", { exact: true })).toBeVisible();

  // Closed, this trail draws no rows at all; opening it draws each call once, in the order the turn ran them.
  await expect(last.getByRole("button", /^Ran echo https:/u)).toHaveCount(0);
  await summaries.nth(2).tap();
  const readRow = last.getByRole("button", /^Read fixture\.txt/u);
  const runRow = last.getByRole("button", /^Ran echo https:/u);
  const editRow = last.getByRole("button", /^Edited missing\.txt/u);
  const tops: number[] = [];
  for (const row of [readRow, runRow, editRow]) {
    await expect(row).toBeVisible();
    tops.push((await row.boundingBox())!.y);
  }
  expect(tops).toEqual([...tops].sort((a, b) => a - b));
  // Each chip is the one this trail's own call proved, read inside the opened fold rather than anywhere in the chat.
  await expect(last.getByRole("link", { name: /^Open .*fixture\.txt in Files$/u })).toBeVisible();
  const pull = last.getByRole("link", { name: "PR #580" });
  await expect(pull).toHaveAttribute("href", "https://github.com/DaniFdz/HUI/pull/580");
  await expect(pull).toHaveAttribute("target", "_blank");
  const sessionChip = last.getByRole("link", { name: /^Open session Referenced session/u });
  await expect(sessionChip).toBeVisible();
  await expect(sessionChip).toHaveAttribute("href", `/sessions/${referenced.id}`);
  // The reply below quotes the same output as prose, whose session reference is a chip of its own, outside the fold.
  await expect(transcript.getByRole("link", { name: /^Open session Referenced session/u })).toHaveCount(2);

  // A trail holding a session chip, then one more turn from the composer: everything the new turn draws must appear.
  // A chip that ejected the template's own child part threw on this render and left the transcript frozen.
  await message.fill("E2E_RICH");
  await send.tap();
  await expect(idle).toBeVisible();
  await expect(trails).toHaveCount(4);
  await expect(transcript.getByText("E2E_RICH", { exact: true })).toHaveCount(2);
  await expect(transcript.getByText("Tool complete")).toHaveCount(2);
  await expect(trails.nth(3).getByRole("button", /^Read fixture\.txt/u)).toHaveCount(0);
  // The trail that holds the chips still draws them, so the transcript was not left half-rendered.
  await expect(sessionChip).toBeVisible();
  await expect(pull).toBeVisible();

  // At a phone width the header is still one visible line and the chips wrap instead of widening the page.
  await hui.phoneScreen();
  await hui.scrollTo(transcript, last);
  await expect(last).toBeVisible();
  await expect(pull).toBeVisible();
  expect(await hui.overflowX()).toBe(0);
});
