/** Shared browser/gateway terminal contract. PTYs are gateway-owned, not PI. */
export type TerminalView = {
  id: string;
  ownerSessionId: string;
  title: string;
  cwd: string;
  cols: number;
  rows: number;
  status: "running" | "exited";
  exitCode?: number;
  createdAt: string;
};
export type TerminalSnapshot = { terminal: TerminalView; data: string; sequence: number; truncated: boolean };
export type TerminalEvent =
  | ({ type: "snapshot" } & TerminalSnapshot)
  | { type: "data"; data: string; sequence: number }
  | { type: "state"; terminal: TerminalView }
  | { type: "error"; error: string };
export type TerminalInput = { action: "input"; data: string } | { action: "resize"; cols: number; rows: number };
