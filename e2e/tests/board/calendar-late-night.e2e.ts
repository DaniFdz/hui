/** A calendar day runs from 5 AM to 5 AM, so work from 9 PM to 1:55 AM is one block in the column of the day it began, and the hour axis grows past 6 PM to cover it (BOARD-062). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

/** Local 5 AM on or before `date`: the calendar's own day boundary. */
const dayStart = (date: Date) => {
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 5);
  if (date < day) day.setDate(day.getDate() - 1);
  return day;
};

/** The 5 AM Monday of the activity week `date` falls in. */
const weekStart = (date: Date) => {
  const day = dayStart(date);
  return new Date(day.getFullYear(), day.getMonth(), day.getDate() - ((day.getDay() + 6) % 7));
};

test("work from 9 PM to 1:55 AM is one block in the column of the day it began, and the hour axis covers it", { tags: ["BOARD-062"], platforms: ["web"] }, async ({ screen, hui }) => {
  const current = dayStart(new Date());
  // The calendar day before the one running: 9 PM to 1:55 AM from there always ends in the past.
  const day = new Date(current.getFullYear(), current.getMonth(), current.getDate() - 1);
  const at = (hour: number) => new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour);
  await hui.recordWork({ title: "Late night work", group: "Night shift", project: "late-night", blocks: [
    { from: at(13), minutes: 60, firstMessage: "Record an afternoon hour." },
    { from: at(21), minutes: 4 * 60 + 55, firstMessage: "Keep the late-night work on the day it began." },
  ] });

  await hui.open("/contributions");
  await screen.getByRole("button", "Calendar").tap();
  // Named by session, so each block carries the title this test chose rather than a repository path.
  await screen.getByRole("button", "Session", { exact: true }).tap();
  // The day before today's activity day is in the week the calendar opens on, unless that day is a Monday.
  if (day < weekStart(new Date())) await screen.getByRole("button", "Previous week").tap();

  const blocks = screen.getByRole("button", { name: /^Late night work, /u });
  await expect(blocks).toHaveCount(2);
  const [afternoon, night] = [blocks.nth(0), blocks.nth(1)];
  // One block, clipped past midnight rather than split at it: 9 PM to 1:55 AM, four hours 55 minutes.
  await expect(night).toHaveAttribute("aria-label", /^Late night work, (?:9:00 PM|21:00) – (?:1:55 AM|01:55), 4h 55m of activity$/u);

  // It is drawn in the column of the day it began, which the column names by its date.
  const column = screen.getByRole("group").filter({ hasText: "Late night work" });
  await expect(column).toHaveCount(1);
  await expect(column).toHaveAttribute("aria-label", new RegExp(`(?:\\D|^)${day.getDate()}$`, "u"));

  // The axis starts at 9 AM and was grown to cover the block: 1 PM sits 4 rows down, 9 PM 12 rows, and the day
  // ends 17 rows in, at the top of the hour the block ends in. An hour's height comes from the two blocks' own
  // distance, so a change to the row height cannot make this pass by accident.
  const box = async (target: typeof afternoon) => {
    const found = await target.boundingBox();
    if (!found) throw new Error("the calendar block lays out no box");
    return found;
  };
  const hour = ((await box(night)).y - (await box(afternoon)).y) / 8;
  expect(hour).toBeGreaterThan(0);
  const laid = await box(column);
  expect(Math.round((await box(afternoon)).y - laid.y)).toBe(Math.round(4 * hour));
  expect(Math.round((await box(night)).y - laid.y)).toBe(Math.round(12 * hour));
  expect(Math.round((await box(night)).height)).toBe(Math.round(((4 * 60 + 55) / 60) * hour) - 2);
  expect(Math.round(laid.height)).toBe(Math.round(17 * hour));

  // The block's own card reads the stretch across midnight as one block of four hours 55 minutes.
  await night.tap();
  const card = screen.getByRole("dialog");
  await expect(card).toBeVisible();
  await expect(card).toContainText(/· (?:9:00 PM|21:00) – (?:1:55 AM|01:55) · 4h 55m of activity/u);
});
