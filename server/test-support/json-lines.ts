/**
 * The lines of a JSON-lines log that another process may still be appending
 * to, such as the provider fixture's request log: only the lines it finished.
 * A record being written has no newline yet, and parsing it would fail the
 * test; the next read has it whole.
 *
 * Test support only: tsconfig.server.json keeps this directory out of the build.
 */
export function completeLines(text: string): string[] {
  return text.split("\n").slice(0, -1).filter(Boolean);
}
