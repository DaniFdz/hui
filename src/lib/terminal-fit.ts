/**
 * Decides whether a terminal pane should resize its emulator (and so its PTY) after a layout change: only when
 * its host is measurable, the proposed grid is valid and within the gateway's limits, and the size differs from
 * the current one. A hidden (0×0) host or an unchanged grid sends nothing.
 */
export type TerminalGrid = { cols: number; rows: number };

export function fittedTerminalSize(host: { clientWidth: number; clientHeight: number }, proposed: TerminalGrid | undefined, current: TerminalGrid): TerminalGrid | undefined {
  if (!proposed || host.clientWidth <= 0 || host.clientHeight <= 0) return undefined;
  const cols = Math.min(500, proposed.cols);
  const rows = Math.min(300, proposed.rows);
  if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 2 || rows < 1) return undefined;
  return cols === current.cols && rows === current.rows ? undefined : { cols, rows };
}
