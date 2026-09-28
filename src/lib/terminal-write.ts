/** The subset of a Ghostty terminal needed to replay PTY output. */
export type TerminalWriter = { write(data: string, callback?: () => void): void };

/**
 * Writes PTY output, skipping empty chunks. ghostty-web 0.4.0 copies each write
 * into a WASM buffer from `alloc(length)`; a zero-length allocation returns an
 * out-of-range sentinel, so an empty write throws `RangeError: offset is out of
 * bounds`. A fresh shell's replay is empty until its first prompt, so the
 * callback still runs to let replay finish.
 */
export function writeTerminal(terminal: TerminalWriter, data: string, callback?: () => void): void {
  if (data) terminal.write(data, callback);
  else callback?.();
}
