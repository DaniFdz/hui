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
/** A terminal's replay as text, for HTTP reads and the agent's terminal tool. The socket's wire format is in
 * shared/terminal-stream.ts. */
export type TerminalSnapshot = { terminal: TerminalView; data: string; sequence: number; truncated: boolean };
