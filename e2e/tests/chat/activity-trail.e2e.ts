/** A live turn's activity trail counts its own clock from the composer's send, marks a failed call and shows the chips
 * its calls proved while it is still folded (CHAT-099). Opened, the same trail draws its reasoning and each run of calls
 * as the base app's own tool card, whose own rows open one at a time. A second prompt after a trail holding a session
 * chip is the regression for the transcript freezing: the chip writes its own text, so Lit owns no part of it and a
 * re-render still draws. */
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

  // One element per stretch, from the summary this test opens to the tool card its body draws.
  const trails = transcript.getByTestId("activity-trail-group");
  const firstTrail = trails.nth(0);
  // Folded, the trail is its summary alone: no tool card and no call row waits behind it.
  await expect(firstTrail.getByText(/^Used 1 tool$/u)).toHaveCount(0);
  await expect(firstTrail.getByRole("button", /^Used fixture echo/u)).toHaveCount(0);
  // Opened, the base app's card draws its own header and one row per call; a row still opens its own body.
  await firstTrail.getByText(/^Worked for \d+s · 1 other call$/u).tap();
  await expect(firstTrail.getByText(/^Used 1 tool$/u)).toBeVisible();
  await firstTrail.getByRole("button", /^Used fixture echo/u).tap();
  await expect(firstTrail.getByRole("button", "Copy output")).toBeVisible();

  // Reasoning and the call it shares a stretch with open together from the one summary.
  await hui.prompt(session, "E2E_RICH");
  await expect(idle).toBeVisible();
  await expect(trails).toHaveCount(2);
  const rich = trails.nth(1);
  // Its file chip hangs on the folded summary, so what the fold touched is read without opening it.
  await expect(rich.getByRole("link", { name: /^Open .*fixture\.txt in Files$/u })).toBeVisible();
  await expect(rich.getByText("Inspecting the fixture.")).toHaveCount(0);
  await expect(rich.getByText(/^Used 1 tool$/u)).toHaveCount(0);
  await rich.getByText(/^Worked for \d+s · 1 read$/u).tap();
  await expect(rich.getByText("Inspecting the fixture.")).toBeVisible();
  await expect(rich.getByText(/^Used 1 tool$/u)).toBeVisible();
  await expect(rich.getByRole("button", /^Read fixture\.txt/u)).toBeVisible();

  // A failed edit marks the collapsed header, and the calls' own data draws their chips on the summary beside it.
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
  const readChip = last.getByRole("link", { name: /^Open .*fixture\.txt in Files$/u });
  const pull = last.getByRole("link", { name: "PR #580" });
  const sessionChip = last.getByRole("link", { name: /^Open session Referenced session/u });
  await expect(readChip).toBeVisible();
  await expect(pull).toHaveAttribute("href", "https://github.com/DaniFdz/HUI/pull/580");
  await expect(pull).toHaveAttribute("target", "_blank");
  await expect(sessionChip).toHaveAttribute("href", `/sessions/${referenced.id}`);

  // The reply below quotes the same output as prose, whose session reference is a chip of its own, outside the fold.
  await expect(transcript.getByRole("link", { name: /^Open session Referenced session/u })).toHaveCount(2);

  // Closed, this trail draws no call of its own; opening it draws the base app's card over them, in the order the turn
  // ran them.
  await expect(last.getByRole("button", /^Ran echo https:/u)).toHaveCount(0);
  await last.getByText(/^Worked for \d+s · 1 edit, 1 read, 1 run/u).tap();
  await expect(last.getByText("Used 3 tools", { exact: true })).toBeVisible();
  const readRow = last.getByRole("button", /^Read fixture\.txt/u);
  const runRow = last.getByRole("button", /^Ran echo https:/u);
  const editRow = last.getByRole("button", /^Edited missing\.txt/u);
  const tops: number[] = [];
  for (const row of [readRow, runRow, editRow]) {
    await expect(row).toBeVisible();
    tops.push((await row.boundingBox())!.y);
  }
  expect(tops).toEqual([...tops].sort((a, b) => a - b));
  // The chips stay on the summary once the card is open: they never move inside a row.
  await expect(readChip).toBeVisible();
  await expect(pull).toBeVisible();
  // A row of the card opens that call's own body, and its own toggle folds it again without folding the trail.
  await readRow.tap();
  await expect(last.getByTestId("tool-call-body")).toContainText("Real SDK browser fixture");
  await readRow.tap();
  await expect(last.getByTestId("tool-call-body")).toHaveCount(0);
  await expect(last.getByText("Used 3 tools", { exact: true })).toBeVisible();

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

  // At a phone width the summary keeps its label and its chips readable, and they wrap instead of widening the page.
  await hui.phoneScreen();
  await hui.scrollTo(transcript, last);
  await expect(last).toBeVisible();
  await expect(last.getByTestId("activity-trail")).toContainText(/^Worked for \d+s · 1 edit, 1 read, 1 run/u);
  await expect(readChip).toBeVisible();
  await expect(pull).toBeVisible();
  await expect(sessionChip).toBeVisible();
  expect(await hui.overflowX()).toBe(0);
});
