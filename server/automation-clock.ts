/** Binds the import-time automation service's clock at backend startup, before any scheduler timer exists. */
import type { Clock } from "./automation.ts";

const realClock: Clock = {
  now: Date.now,
  setTimer: (callback, delay) => setTimeout(callback, delay),
  clearTimer: (timer) => clearTimeout(timer),
};

export function createAutomationClockBinding() {
  let selected: Clock = realClock;
  let bound = false;
  return {
    clock: {
      now: () => selected.now(),
      setTimer: (callback, delay) => selected.setTimer(callback, delay),
      clearTimer: (timer) => selected.clearTimer(timer),
    } satisfies Clock,
    bind(clock: Clock = realClock): void {
      if (bound && selected !== clock) throw new Error("The automation clock is already bound; stop the backend before changing it.");
      selected = clock;
      bound = true;
    },
    /** Called only after automation.dispose() has cleared timers through their original owner. */
    reset(): void {
      selected = realClock;
      bound = false;
    },
  };
}
