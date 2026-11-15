/**
 * The controllable clock the shared suite installs in a page when a use case needs a timer to pass: an archive toast's
 * 15 seconds, the 6 seconds a success toast clears itself after, the 40 seconds a silent conversation waits before it
 * reconnects. `Date.now()` and every timer the page schedules from the install on run on a clock that only
 * `hui.advanceClock` moves, so a test asserts both sides of a deadline — still there a second before, gone a second
 * after — without waiting for it in real time.
 *
 * Deliberately small, and it says so: `performance.now()` and `requestAnimationFrame` stay real, so the app's rendering
 * and animations keep running while its clock stands still; `new Date()` still reads the real clock; a timer due at
 * once (a delay of 0 or less) is a task the app expects on the loop's next turn, so it is left to the browser rather
 * than to an advance that would never come. A use case that needs the wall clock, `new Date()` or an animation to move
 * needs a bigger seam than this one, and says so where it is proved.
 *
 * The clock is installed in the page that is open and, through an init script, in every page after it, so a reload
 * keeps it. Nothing else in the suite installs it: a test that does not ask for the clock runs on the real one.
 */

/** The page's handle on the clock `installClock` left behind. */
type PageClock = { now(): number; advance(ms: number): number };

/** Installs the clock in a page (once), and answers the time it starts at. Runs in the page, so it closes over nothing. */
export const installClock = (start?: number) => {
  const page = window as unknown as { huiClock?: PageClock };
  if (page.huiClock) {
    if (start !== undefined) {
      if (start < page.huiClock.now()) throw new Error("The page clock cannot move backwards");
      page.huiClock.advance(start - page.huiClock.now());
    }
    return page.huiClock.now();
  }
  const native = {
    setTimeout: window.setTimeout.bind(window),
    clearTimeout: window.clearTimeout.bind(window),
    now: Date.now.bind(Date),
  };
  type Entry = { at: number; every?: number; run: () => void; armed?: number };
  let time = start ?? native.now();
  let nextId = 1;
  const entries = new Map<number, Entry>();
  // A timer due at once is a task the app expects on the loop's next turn — a render flush, a boot step — and running
  // one passes no time, so it is left to the browser instead of waiting for an advance that a frozen clock never makes.
  const arm = (id: number) => {
    const entry = entries.get(id);
    if (!entry || entry.armed !== undefined) return;
    entry.armed = native.setTimeout(() => {
      entry.armed = undefined;
      if (entries.get(id) !== entry) return;
      entries.delete(id);
      entry.run();
    }, 0);
  };
  const schedule = (run: () => void, delay: unknown, every: boolean) => {
    const ms = Math.max(0, Number(delay) || 0);
    const id = nextId++;
    entries.set(id, every ? { at: time + ms, every: Math.max(1, ms), run } : { at: time + ms, run });
    if (ms === 0) arm(id);
    return id;
  };
  const clear = (id: unknown) => {
    const entry = typeof id === "number" ? entries.get(id) : undefined;
    if (!entry) return;
    if (entry.armed !== undefined) native.clearTimeout(entry.armed);
    entries.delete(id as number);
  };
  window.setTimeout = ((handler: TimerHandler, delay?: number, ...args: unknown[]) => schedule(
    typeof handler === "function" ? () => handler(...args) : () => {}, delay, false)) as typeof window.setTimeout;
  window.setInterval = ((handler: TimerHandler, delay?: number, ...args: unknown[]) => schedule(
    typeof handler === "function" ? () => handler(...args) : () => {}, delay, true)) as typeof window.setInterval;
  window.clearTimeout = ((id?: number) => clear(id)) as typeof window.clearTimeout;
  window.clearInterval = ((id?: number) => clear(id)) as typeof window.clearInterval;
  Date.now = () => time;
  const advance = (ms: number) => {
    const target = time + Math.max(0, Number(ms) || 0);
    // Every timer due up to the target fires in the order it is due at, and an interval comes back for its next turn. A
    // timer that reschedules itself at no delay would keep the loop here forever, which in a page is a hung tab, so the
    // bound names it instead of hanging the run.
    for (let fired = 0; ; fired += 1) {
      if (fired >= 10_000) throw new Error("advanceClock: 10000 timers fired within one advance; a timer reschedules itself without time passing");
      let due: [number, Entry] | undefined;
      for (const [id, entry] of entries) {
        if (entry.at > target || entry.armed !== undefined) continue;
        if (due === undefined || entry.at < due[1].at) due = [id, entry];
      }
      if (due === undefined) break;
      const [id, entry] = due;
      time = entry.at;
      if (entry.every === undefined) entries.delete(id);
      else entry.at = entry.at + entry.every;
      entry.run();
    }
    time = target;
    return time;
  };
  page.huiClock = { now: () => time, advance };
  return time;
};

/** Advances the clock a page holds, and answers the time it now reads. Runs in the page, so it closes over nothing. */
export const advanceClock = (ms: number) => {
  const page = window as unknown as { huiClock?: PageClock };
  if (!page.huiClock) throw new Error("advanceClock: this page has no controllable clock; call hui.controllableClock() first");
  return page.huiClock.advance(ms);
};
