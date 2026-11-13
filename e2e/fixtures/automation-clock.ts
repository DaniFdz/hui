/** Owns an isolated automation scheduler clock; wall time and every other gateway timer stay native. */
type Timer = ReturnType<typeof setTimeout>;
type NativeClock = {
  now(): number;
  setTimer(callback: () => void, delay: number): Timer;
  clearTimer(handle: Timer): void;
};
type Entry = { callback: () => void; at: number; armed?: Timer; referenced: boolean };

const nativeClock: NativeClock = {
  now: () => Date.now(),
  setTimer: (callback, delay) => setTimeout(callback, delay),
  clearTimer: (handle) => clearTimeout(handle),
};

/** A numeric state restores only virtual time; the scheduler itself restores its tasks and execution state. */
export function createAutomationClock(initialNow: number | null = null, native: NativeClock = nativeClock) {
  if (initialNow !== null && !Number.isFinite(initialNow)) throw new RangeError("Invalid automation clock time");
  let frozenNow = initialNow;
  let disposed = false;
  const timers = new Map<Timer, Entry>();
  const now = () => frozenNow ?? native.now();
  const active = () => {
    if (disposed) throw new Error("Automation clock is disposed");
  };
  const disarm = (entry: Entry) => {
    if (entry.armed === undefined) return;
    native.clearTimer(entry.armed);
    entry.armed = undefined;
  };
  const arm = (handle: Timer, entry: Entry) => {
    const armed = native.setTimer(() => {
      if (frozenNow !== null || timers.get(handle) !== entry || entry.armed !== armed) return;
      timers.delete(handle);
      entry.armed = undefined;
      entry.callback();
    }, Math.max(0, entry.at - native.now()));
    entry.armed = armed;
    if (!entry.referenced) armed.unref();
  };
  const clock: NativeClock = {
    now,
    setTimer(callback, delay) {
      active();
      if (!Number.isFinite(delay)) throw new RangeError("Invalid automation timer delay");
      const entry: Entry = { callback, at: now() + Math.max(0, delay), referenced: true };
      // The stable handle survives native timer cancellation/rearming when switching clock modes.
      const handle = {
        unref() { entry.referenced = false; entry.armed?.unref(); return handle; },
        ref() { entry.referenced = true; entry.armed?.ref(); return handle; },
        hasRef() { return entry.referenced; },
      } as unknown as Timer;
      timers.set(handle, entry);
      if (frozenNow === null) arm(handle, entry);
      return handle;
    },
    clearTimer(handle) {
      const entry = timers.get(handle);
      if (!entry) return;
      disarm(entry);
      timers.delete(handle);
    },
  };
  return {
    clock,
    freeze(): number {
      active();
      if (frozenNow === null) {
        frozenNow = native.now();
        for (const entry of timers.values()) disarm(entry);
      }
      return frozenNow;
    },
    advance(ms: number): number {
      active();
      if (frozenNow === null) throw new Error("Freeze the automation clock before advancing it");
      const target = frozenNow + ms;
      if (!Number.isFinite(ms) || ms < 0 || !Number.isFinite(target)) throw new RangeError("Invalid automation clock advance");
      for (let fired = 0; ; fired += 1) {
        let due: [Timer, Entry] | undefined;
        for (const timer of timers) {
          if (timer[1].at <= target && (!due || timer[1].at < due[1].at)) due = timer;
        }
        if (!due) break;
        if (fired >= 10_000) throw new Error("Automation clock advance fired 10000 timers without settling");
        frozenNow = Math.max(frozenNow, due[1].at);
        timers.delete(due[0]);
        due[1].callback();
        // A callback may deliberately release the fixture rather than continue virtual time.
        if (disposed || frozenNow === null) return now();
      }
      // A callback can advance farther; finishing this older advance must never rewind it.
      frozenNow = Math.max(frozenNow, target);
      return frozenNow;
    },
    resume(): void {
      active();
      if (frozenNow === null) return;
      const realNow = native.now();
      const offset = realNow - frozenNow;
      frozenNow = null;
      for (const [handle, entry] of timers) {
        entry.at += offset;
        arm(handle, entry);
      }
    },
    state: (): number | null => frozenNow,
    dispose(): void {
      for (const entry of timers.values()) disarm(entry);
      timers.clear();
      disposed = true;
    },
  };
}
