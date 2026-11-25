/**
 * The shape of HUI's use-case catalogue: one entry per user outcome, with the SPEC section that defines it, the code
 * surfaces it owns and its status on the web and on the phone (the `android` e2e target). Each area's entries live in
 * `<area>.ts` beside this file.
 */

export type Status = "required" | "backlog" | { excluded: string; decision: string };

export type UseCase = {
  id: string;
  title: string;
  behaviour: string;
  spec: string[];
  surfaces: string[];
  journeys?: string[];
  web: Status;
  /**
   * The outcome on the phone: `required` when a shared test proves it on the `android` target, an exclusion with the
   * SPEC decision behind it for a case a phone cannot reach (a keyboard chord, the wide layout, a hover, a secondary
   * click), else `backlog`. The phone apps wrap the web UI (SPEC.md), so an entry is excluded here only for a phone's
   * own limits, never because the phone drew its own screen.
   */
  phone: Status;
};

export const AREAS = ["SHELL", "SESS", "CHAT", "RICH", "AGENT", "WORK", "BOARD", "SET", "PAGE", "BOT", "CALL"] as const;
export type Area = (typeof AREAS)[number];
