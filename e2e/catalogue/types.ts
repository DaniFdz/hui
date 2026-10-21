/**
 * The shape of HUI's use-case catalogue: one entry per user outcome, with the SPEC section that defines it, the code
 * surfaces it owns and its status on the web and on iOS. Each area's entries live in `<area>.ts` beside this file.
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
  ios: Status;
};

export const AREAS = ["SHELL", "SESS", "CHAT", "RICH", "AGENT", "WORK", "BOARD", "SET", "PAGE", "BOT", "CALL"] as const;
export type Area = (typeof AREAS)[number];
