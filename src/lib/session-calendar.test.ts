import assert from "node:assert/strict";
import { test } from "node:test";
import type { ActivityBlock, ActivitySession } from "../../shared/session-activity.ts";
import { calendarWeek, formatDuration, weekStart } from "./session-calendar.ts";

const MONDAY = new Date(2026, 8, 28, 5);
/** Local time on a day of the week of Sep 28, 2026. */
const at = (day: number, hour: number, minute = 0) => new Date(2026, 8, 28 + day, hour, minute).valueOf();
const block = (start: number, end: number, extra: Partial<ActivityBlock> = {}): ActivityBlock => ({ start, end, ...extra });
const session = (id: string, blocks: ActivityBlock[]): ActivitySession => ({ id, title: id, group: "hui", blocks });

test("weeks start at 5 AM on Monday, so the small hours belong to the day before", () => {
  assert.equal(weekStart(new Date(2026, 9, 4, 23, 30)).valueOf(), MONDAY.valueOf(), "Sunday belongs to the week before");
  assert.equal(weekStart(new Date(2026, 9, 5, 4, 59)).valueOf(), MONDAY.valueOf(), "Monday before 5 AM is still Sunday night");
  assert.equal(weekStart(new Date(2026, 8, 28, 5)).valueOf(), MONDAY.valueOf());
  assert.equal(weekStart(new Date(2026, 9, 5, 8)).valueOf(), new Date(2026, 9, 5, 5).valueOf());
});

test("durations read as hours and zero-padded minutes", () => {
  assert.deepEqual([0, 29_000, 22 * 60_000, 3 * 3_600_000 + 5 * 60_000, 43 * 3_600_000 + 6 * 60_000].map(formatDuration), ["<1m", "<1m", "22m", "3h 05m", "43h 06m"]);
});

test("parallel sessions count once in the week's working time and per day, and once each per session", () => {
  const week = calendarWeek({ sessions: [
    session("checkout", [block(at(0, 9), at(0, 12)), block(at(2, 22), at(3, 1)), block(at(3, 4), at(3, 6))]),
    session("evals", [block(at(0, 10), at(0, 11))]),
    session("infra", [block(at(0, 11, 30), at(0, 13))]),
  ] }, MONDAY);
  assert.deepEqual(week.sessions.map(({ session: { id }, ms, color }) => ({ id, hours: ms / 3_600_000, color })), [
    { id: "checkout", hours: 8, color: 0 },
    { id: "infra", hours: 1.5, color: 1 },
    { id: "evals", hours: 1, color: 2 },
  ]);
  assert.equal(week.activeMs, 9 * 3_600_000, "Monday 9–13, Wednesday night 22–1 and Thursday 4–6");
  assert.equal(week.sessionMs, 10.5 * 3_600_000);
  assert.equal(week.peak, 2);
  // Wednesday's night stays on Wednesday; a block across 5 AM is split there.
  assert.deepEqual(week.days.map((day) => day.activeMs / 3_600_000), [4, 0, 4, 1, 0, 0, 0]);
  assert.deepEqual(week.days[2]!.blocks.map(({ start, end }) => [start, end]), [[at(2, 22), at(3, 1)], [at(3, 4), at(3, 5)]]);
  assert.deepEqual(week.days[3]!.blocks.map(({ start, end }) => [start, end]), [[at(3, 5), at(3, 6)]]);
  assert.deepEqual(week.hours, [5, 29], "from 5 AM to 5 AM the next morning");
});

test("overlapping blocks share their day in side-by-side lanes", () => {
  const week = calendarWeek({ sessions: [
    session("a", [block(at(1, 9), at(1, 12))]),
    session("b", [block(at(1, 10), at(1, 11))]),
    session("c", [block(at(1, 11, 30), at(1, 13))]),
    session("d", [block(at(1, 18), at(1, 18))]),
  ] }, MONDAY);
  const lanes = Object.fromEntries(week.days[1]!.blocks.map(({ session: { id }, lane, lanes: count }) => [id, [lane, count]]));
  // b's lane is free again once b ends, so c takes it; d stands alone.
  assert.deepEqual(lanes, { a: [0, 2], b: [1, 2], c: [1, 2], d: [0, 1] });
  assert.deepEqual(week.hours, [9, 19], "working hours, and a one-message block drawn for 15 minutes");
});

test("blocks outside the week, or ending as it starts, are left out", () => {
  const week = calendarWeek({ sessions: [
    session("before", [block(at(-1, 22), at(0, 5))]),
    session("after", [block(at(7, 9), at(7, 10))]),
  ] }, MONDAY);
  assert.deepEqual(week.sessions, []);
  assert.equal(week.activeMs, 0);
  assert.deepEqual(week.hours, [9, 18], "an empty week shows working hours");
});
