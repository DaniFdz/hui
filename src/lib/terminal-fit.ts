/**
 * Keeps a terminal pane's grid and its PTY size honest while the Work pane hides it: the emulator must never fit
 * itself to a hidden (0×0) host, and the pane sends the PTY a new size only when its host is measurable, the grid
 * is valid and within the gateway's limits, and the size differs from the last one the PTY was given. Before a
 * width change reaches the shell, the reflowed line under the cursor (normally the prompt) is cleared locally, so the
 * shell's redraw after SIGWINCH does not leave a broken copy of it behind.
 */
export type TerminalGrid = { cols: number; rows: number };
export type MeasurableHost = { clientWidth: number; clientHeight: number };

export function measurable(host: MeasurableHost | null | undefined): host is MeasurableHost {
  return !!host && host.clientWidth > 0 && host.clientHeight > 0;
}

/** The grid to send the PTY after a layout change, or undefined when nothing should be sent. */
export function ptyResize(host: MeasurableHost | null | undefined, grid: TerminalGrid, sent: TerminalGrid): TerminalGrid | undefined {
  if (!measurable(host)) return undefined;
  const cols = Math.min(500, grid.cols);
  const rows = Math.min(300, grid.rows);
  if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 2 || rows < 1) return undefined;
  return cols === sent.cols && rows === sent.rows ? undefined : { cols, rows };
}

/** The part of a Gespenst terminal that fits its grid to its container. */
export type FittingTerminal = { resize(cols?: number, rows?: number): void; fit(): void };

/**
 * Makes `terminal` skip container fits while `host` measures 0×0. Gespenst refits on every ResizeObserver callback,
 * on `setFont` and when revealed, and a collapsed Work pane (display: none) measures 0×0, which would shrink the grid
 * to its minimum and reflow the screen. Explicit sizes (`resize(cols, rows)`, used for the PTY's replayed size) still
 * apply. Gespenst 0.1.2 calls these methods through the instance, so instance properties take effect for its own calls.
 */
export function skipHiddenFits(terminal: FittingTerminal, host: () => MeasurableHost | null | undefined): void {
  const resize = terminal.resize.bind(terminal);
  const fit = terminal.fit.bind(terminal);
  terminal.resize = (cols?: number, rows?: number) => {
    if ((cols === undefined || rows === undefined) && !measurable(host())) return;
    resize(cols, rows);
  };
  terminal.fit = () => { if (measurable(host())) fit(); };
}

/** The part of a Gespenst buffer row that says whether it continues the row above (a soft wrap). */
export type WrapRow = { index: number; wrapContinuation: boolean };

/** How many rows above the cursor's row belong to the same soft-wrapped line. */
export function wrappedRowsAbove(rows: readonly WrapRow[], cursorIndex: number): number {
  const byIndex = new Map(rows.map((row) => [row.index, row]));
  let above = 0;
  while (byIndex.get(cursorIndex - above)?.wrapContinuation) above++;
  return above;
}

/**
 * Local output that erases the cursor's soft-wrapped line and everything below it, leaving the cursor at its start.
 * Shells redraw their prompt for the new width after SIGWINCH starting at the cursor's row (bash clears only that
 * row), so a prompt the emulator already reflowed onto several rows would otherwise stay behind half-erased.
 */
export function clearWrappedLine(rowsAbove: number): string {
  return `\r${rowsAbove > 0 ? `\u001b[${rowsAbove}A` : ""}\u001b[J`;
}
