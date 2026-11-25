/** A live turn's activity trail counts its own clock, marks a failed call while still collapsed, and opens the file,
 * pull-request and session chips its calls proved (CHAT-099). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

const call = (verb: "CALL" | "HOLD", calls: { name: string; input: Record<string, unknown> }[]) =>
  `E2E_${verb}:${Buffer.from(JSON.stringify(calls)).toString("base64url")}`;

test("a turn's activity trail times the turn, marks a failure and opens its chips", { tags: ["CHAT-099"], platforms: ["web"] }, async ({ screen, hui }) => {
  const transcript = screen.getByTestId("transcript");
  const idle = screen.getByLabel("Session status: Idle");
  // The chip needs a session the registry knows by its own id.
  const referenced = await hui.createSession({ title: "Referenced session" });
  const session = await hui.createSession({ title: "Activity trail" });
  await hui.open(`/sessions/${session.id}`);
  await expect(idle).toBeVisible();

  // While a call is held the trail counts up on its own, one second at a time and with no reload.
  await hui.prompt(session, call("HOLD", [{ name: "fixture_echo", input: { text: "held" } }]));
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

  // Reasoning and the call it shares a stretch with open together from the one summary.
  await hui.prompt(session, "E2E_RICH");
  await expect(idle).toBeVisible();
  const trails = transcript.getByTestId("activity-trail");
  await expect(trails).toHaveCount(2);
  await trails.nth(1).tap();
  await expect(transcript.getByText("Inspecting the fixture.")).toBeVisible();
  await expect(transcript.getByRole("button", /^Read fixture\.txt/u)).toBeVisible();
  await expect(transcript.getByRole("link", { name: /^Open .*fixture\.txt in Files$/u })).toBeVisible();

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
  await expect(last).toContainText(/^Worked for \d+s · 1 edit, 1 read, 1 run/u);
  await expect(last.getByText("failed", { exact: true })).toBeVisible();

  await last.tap();
  const readRow = transcript.getByRole("button", /^Read fixture\.txt/u).last();
  const runRow = transcript.getByRole("button", /^Ran echo https:/u);
  const editRow = transcript.getByRole("button", /^Edited missing\.txt/u);
  const tops: number[] = [];
  for (const row of [readRow, runRow, editRow]) {
    await expect(row).toBeVisible();
    tops.push((await row.boundingBox())!.y);
  }
  expect(tops).toEqual([...tops].sort((a, b) => a - b));
  const pull = transcript.getByRole("link", { name: "PR #580" });
  await expect(pull).toHaveAttribute("href", "https://github.com/DaniFdz/HUI/pull/580");
  await expect(pull).toHaveAttribute("target", "_blank");
  // The reply below quotes the same output as prose, whose session reference is a chip of its own; the chip drawn
  // first is the call's own, inside the trail that was just opened.
  await expect(transcript.getByRole("link", { name: /^Open session Referenced session/u }).first()).toBeVisible();

  // At a phone width the header is still one visible line and the chips wrap instead of widening the page.
  await hui.phoneScreen();
  await hui.scrollTo(transcript, last);
  await expect(last).toBeVisible();
  await expect(pull).toBeVisible();
  expect(await hui.overflowX()).toBe(0);
});
