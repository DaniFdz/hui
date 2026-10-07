/**
 * How a test waits for state it cannot await. It reads every 10 ms, through
 * setTimeout so a wait never spins a CPU core that the other test files of the
 * run need, and gives up after a wall-clock deadline: 10 s by default, far past
 * any healthy wait and far inside npm test's five-minute limit. A wait that
 * times out fails with what it waited for and the state it last saw, instead
 * of holding its file open until the runner kills it with no clue.
 *
 * Test support only: tsconfig.server.json keeps this directory out of the build.
 */
import { inspect } from "node:util";

// Captured at import: a test that mocks timers must not freeze its own waits.
const sleep = globalThis.setTimeout;

export type WaitOptions = {
  /** Wall-clock budget, 10 s by default. */
  timeoutMs?: number;
  /** What a timeout reports: the state the wait depends on. The last value read by default. */
  state?: () => unknown;
};

/**
 * Resolves with the first truthy value `read` returns, polling every 10 ms. A
 * value `read` throws fails the wait at once, as it would without one.
 */
export async function waitFor<T>(
  label: string,
  read: () => T | Promise<T>,
  { timeoutMs = 10_000, state }: WaitOptions = {},
): Promise<NonNullable<Awaited<T>>> {
  const deadline = performance.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (value) return value as NonNullable<Awaited<T>>;
    if (performance.now() >= deadline) {
      const seen = state ? await state() : value;
      throw new Error(`Timed out after ${timeoutMs} ms waiting for ${label}. Last state: ${inspect(seen, { depth: 8, breakLength: Infinity })}`);
    }
    await new Promise((resolve) => sleep(resolve, 10));
  }
}
