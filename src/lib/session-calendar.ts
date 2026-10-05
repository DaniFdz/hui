/** Browser half of the Calendar tab: loads a week of session activity and lays
 * its blocks out in local-time days, Monday first. A day runs from 5 AM to
 * 5 AM, so late-night work stays on the day it began. */
import type { ActivityBlock, ActivitySession, SessionActivity } from "../../shared/session-activity.ts";
import { fetchJson } from "./settings-store.ts";

const MINUTE = 60_000;
const DAY_START_HOUR = 5;
/** Shortest drawn block, so a one-message stretch stays visible and clickable. */
export const MIN_DRAWN_MS = 30 * MINUTE;
/** Colors in session-calendar.css: the session palette, then a shaded set; the week's busiest session takes the first. */
const COLORS = 16;

export type CalendarBlock = {
  session: ActivitySession;
  color: number;
  block: ActivityBlock;
  /** The part of the block inside its day, in epoch milliseconds. */
  start: number;
  end: number;
  /** Column among the blocks it overlaps, and how many columns they share. */
  lane: number;
  lanes: number;
};
export type CalendarDay = { date: Date; blocks: CalendarBlock[]; activeMs: number };
export type CalendarSession = { session: ActivitySession; color: number; ms: number };
export type CalendarWeek = {
  days: CalendarDay[];
  /** Every session with time this week, most time first. */
  sessions: CalendarSession[];
  /** Wall-clock working time: parallel sessions counted once. */
  activeMs: number;
  /** Time summed per session. */
  sessionMs: number;
  /** Most sessions active at the same moment. */
  peak: number;
  /** Hours since midnight the grid shows, `[first, last)`: working hours and
   * every block. Past 24 is the next morning. */
  hours: [number, number];
};

export function loadSessionActivity(start: Date, end: Date): Promise<SessionActivity> {
  return fetchJson<SessionActivity>(`/__hui/session-activity?from=${start.valueOf()}&to=${end.valueOf()}`);
}

/** 5 AM on the Monday of the calendar day `date` falls in. */
export function weekStart(date: Date): Date {
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate(), date.getHours() - DAY_START_HOUR, date.getMinutes());
  return new Date(day.getFullYear(), day.getMonth(), day.getDate() - ((day.getDay() + 6) % 7), DAY_START_HOUR);
}

/** The same wall-clock time `days` later, across daylight saving changes. */
export const addDays = (date: Date, days: number) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days, date.getHours(), date.getMinutes());

/** `3h 05m`, `22m`, or `<1m`. */
export function formatDuration(ms: number): string {
  const minutes = Math.round(ms / MINUTE);
  if (minutes < 1) return "<1m";
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

/** A block with time inside `[from, to)`, or a single message in it. */
const overlaps = (block: ActivityBlock, from: number, to: number) => block.start < to && (block.end > from || block.start >= from);

/** Wall-clock hours since midnight of `day`'s date, past 24 for the next morning; at most the day's end. */
export function localHour(ms: number, day: Date): number {
  const date = new Date(Math.min(ms, addDays(day, 1).valueOf()));
  const hours = date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600;
  return date.getDate() === day.getDate() ? hours : hours + 24;
}

/** Total length of the union of `[start, end)` intervals. */
function unionMs(intervals: readonly (readonly [number, number])[]): number {
  let total = 0;
  let reach = -Infinity;
  for (const [start, end] of [...intervals].sort((a, b) => a[0] - b[0])) {
    if (end > reach) total += end - Math.max(start, reach);
    reach = Math.max(reach, end);
  }
  return total;
}

function peakOverlap(intervals: readonly (readonly [number, number])[]): number {
  // Ends sort before starts at the same instant: back-to-back is not parallel.
  const events = intervals.flatMap(([start, end]) => end > start ? [[start, 1], [end, -1]] as const : []).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let current = 0;
  let peak = 0;
  for (const [, change] of events) peak = Math.max(peak, current += change);
  return peak;
}

/** Side-by-side columns for blocks whose drawn extents overlap, like a day view. */
function assignLanes(blocks: CalendarBlock[]): void {
  const drawnEnd = (block: CalendarBlock) => Math.max(block.end, block.start + MIN_DRAWN_MS);
  blocks.sort((a, b) => a.start - b.start || drawnEnd(b) - drawnEnd(a));
  let cluster: CalendarBlock[] = [];
  let laneEnds: number[] = [];
  const close = () => { for (const block of cluster) block.lanes = laneEnds.length; cluster = []; laneEnds = []; };
  for (const block of blocks) {
    if (cluster.length && laneEnds.every((end) => end <= block.start)) close();
    const free = laneEnds.findIndex((end) => end <= block.start);
    block.lane = free < 0 ? laneEnds.length : free;
    laneEnds[block.lane] = drawnEnd(block);
    cluster.push(block);
  }
  close();
}

export function calendarWeek(activity: SessionActivity, start: Date): CalendarWeek {
  const days = Array.from({ length: 7 }, (_, index) => ({ date: addDays(start, index), next: addDays(start, index + 1).valueOf() }));
  const weekFrom = start.valueOf();
  const weekTo = days[6]!.next;
  const clipped = (block: ActivityBlock, from: number, to: number) => [Math.max(block.start, from), Math.min(block.end, to)] as const;
  const inWeek = (block: ActivityBlock) => overlaps(block, weekFrom, weekTo);

  const sessions = activity.sessions
    .map((session) => ({ session, ms: session.blocks.filter(inWeek).reduce((sum, block) => { const [from, to] = clipped(block, weekFrom, weekTo); return sum + to - from; }, 0) }))
    .filter(({ session }) => session.blocks.some(inWeek))
    .sort((a, b) => b.ms - a.ms || a.session.title.localeCompare(b.session.title))
    .map((entry, index) => ({ ...entry, color: index % COLORS }));

  const intervals = sessions.flatMap(({ session }) => session.blocks.filter(inWeek).map((block) => clipped(block, weekFrom, weekTo)));
  let first = 9;
  let last = 18;
  const calendarDays = days.map(({ date, next }) => {
    const from = date.valueOf();
    const blocks: CalendarBlock[] = sessions.flatMap(({ session, color }) => session.blocks
      .filter((block) => overlaps(block, from, next))
      .map((block) => { const [start, end] = clipped(block, from, next); return { session, color, block, start, end, lane: 0, lanes: 1 }; }));
    assignLanes(blocks);
    for (const block of blocks) {
      first = Math.min(first, Math.floor(localHour(block.start, date)));
      last = Math.max(last, Math.ceil(localHour(Math.max(block.end, block.start + MIN_DRAWN_MS), date)));
    }
    return { date, blocks, activeMs: unionMs(blocks.map((block) => [block.start, block.end] as const)) };
  });
  return {
    days: calendarDays,
    sessions,
    activeMs: unionMs(intervals),
    sessionMs: sessions.reduce((sum, { ms }) => sum + ms, 0),
    peak: peakOverlap(intervals),
    hours: [first, last],
  };
}
