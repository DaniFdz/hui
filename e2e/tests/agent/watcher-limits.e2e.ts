/** An agent's watchers at their limits: the tenth slot, the agent's own dismiss, the refusals that keep a watcher's
 * definition honest, and a keep-running watcher that starts itself again when all its processes die (AGENT-041,
 * AGENT-042). */
import { expect, type Locator } from "e2e";
import { test } from "../../fixtures/hui.ts";
import { openSettledWatchers, openWatchers } from "./run-status.ts";

const watcher = (inputs: Record<string, unknown>[]) =>
  `E2E_CALL:${Buffer.from(JSON.stringify(inputs.map((input) => ({ name: "watcher", input })))).toString("base64url")}`;
const start = (purpose: string, command: string, extra: Record<string, unknown> = {}) =>
  ({ action: "start", purpose, command, ...extra });

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** The watcher's id, which its log path carries, read off an opened row. */
const idOf = (path: string) => /([^/]+)\.log$/u.exec(path.replace(/^PID \d+ · /u, ""))?.[1];
const pidOf = (path: string) => Number(/^PID (\d+) · /u.exec(path)?.[1]);

/** More than four rows sit behind Watcher details; open that list when the row is folded away and leave it as it is. */
const showRows = async (watchers: Locator, row: Locator) => {
  if (!(await row.isVisible())) await watchers.getByText(/^Watcher details/u).tap();
};

test("a conversation at ten watchers refuses a new one, and the agent's own dismiss frees a slot without a reload", { tags: ["AGENT-041"], platforms: ["web"] }, async ({ screen, hui }) => {
  const transcript = screen.getByTestId("transcript");
  const session = await hui.createSession({ title: "Watcher limit" });
  await hui.open(`/sessions/${session.id}`);

  // Ten in one turn: one that finishes at once, and nine that keep running.
  await hui.prompt(session, watcher([
    start("Settled watcher", "printf 'settled\\n'"),
    ...Array.from({ length: 9 }, (_, index) => start(`Wait ${index + 1}`, "sleep 600")),
  ]));
  const watchers = await openSettledWatchers(screen, "Settled watcher", "9 running");
  await expect(watchers.getByText("9 running", { exact: true })).toBeVisible({ timeout: 90_000 });
  await watchers.getByText(/^Watcher details/u).tap();

  // Each prompt's run closes the panel it opened by itself; this test reads the rows again through the operator's own
  // open, once the turn it waited for has settled and its panel is closed.
  const reopened = async () => {
    await expect(screen.getByLabel("Session status: Idle")).toBeVisible();
    await expect(screen.getByLabel("Run status")).toBeHidden();
    const rows = await openWatchers(screen);
    await showRows(rows, rows.getByText("Wait 1"));
    return rows;
  };

  // The cap holds: a new start fails with what to do about it.
  await hui.prompt(session, watcher([start("One too many", "sleep 600")]));
  await expect(transcript.getByText(/This conversation already has 10 watchers\. Dismiss finished ones first\./u)).toBeVisible();
  const capped = await reopened();

  // Dismissing a running watcher is refused, and a restart cannot rewrite a watcher's command.
  await capped.getByText("Wait 1").tap();
  const runningId = idOf(String(await capped.getByText(/^PID \d+ · .+\.log$/u).textContent()));
  await capped.getByText("Wait 1").tap();
  await hui.prompt(session, watcher([{ action: "dismiss", id: runningId }]));
  await expect(transcript.getByText(/Stop the watcher before dismissing it\./u)).toBeVisible();
  await hui.prompt(session, watcher([{ action: "restart", id: runningId, command: "printf 'something else\\n'" }]));
  await expect(transcript.getByText(/restart re-runs the recorded command and takes only an id\. To run something else, start a new watcher\./u)).toBeVisible();
  const retried = await reopened();

  // The settled one can be dismissed by the agent, and the summary follows without a reload.
  await retried.getByText("Settled watcher").tap();
  await expect(retried.getByText(/^Done · /u)).toBeVisible({ timeout: 90_000 });
  const settledId = idOf(String(await retried.getByText(/^PID \d+ · .+\.log$/u).textContent()));
  await retried.getByText("Settled watcher").tap();
  await hui.prompt(session, watcher([{ action: "dismiss", id: settledId }]));
  // The dismiss runs inside this turn, so the poll waits for the row to leave; a closed panel still holds its rows.
  await expect.poll(async () => hui.textOf(screen.getByLabel("Run status")), { timeout: 90_000 }).not.toContain("Settled watcher");
  const freed = await reopened();
  await expect(freed.getByText("Settled watcher")).toBeHidden();
  await expect(freed.getByText("9 running", { exact: true })).toBeVisible();

  // The freed slot takes the new watcher, in the same list.
  await hui.prompt(session, watcher([start("One too many", "sleep 600")]));
  const again = await openSettledWatchers(screen, "One too many", "10 running");
  await expect(again.getByText("10 running", { exact: true })).toBeVisible();
  await expect(again.getByText("One too many")).toBeVisible();
});

test("a keep-running watcher survives its shell, starts again with a new PID when all its processes die, and Stop ends it", { tags: ["AGENT-042"], platforms: ["web"] }, async ({ screen, hui }) => {
  const transcript = screen.getByTestId("transcript");
  const session = await hui.createSession({ title: "Keep-running watcher" });
  await hui.open(`/sessions/${session.id}`);
  const ticks = async () => (await hui.textOf(log)).split("tick").length - 1;

  await hui.prompt(session, watcher([start("Watch the deploy", "i=0; while true; do i=$((i+1)); printf 'tick %s\\n' \"$i\"; sleep 1; done", { keepRunning: true })]));
  const watchers = await openSettledWatchers(screen, "Watch the deploy", "Running · ");
  const log = screen.getByLabel("Watcher log");
  await expect(watchers.getByText("Watch the deploy")).toBeVisible({ timeout: 90_000 });
  await watchers.getByText("Watch the deploy").tap();
  await expect(watchers.getByText("Keeps running: HUI starts it again if it dies. Stop ends it.")).toBeVisible();
  await expect.poll(ticks, { timeout: 90_000 }).toBeGreaterThan(1);
  const path = watchers.getByText(/^PID \d+ · .+\.log$/u);
  const first = pidOf(String(await path.textContent()));

  // Killing the shell alone leaves the job running, so HUI neither restarts nor forgets it.
  process.kill(first, "SIGKILL");
  const before = await ticks();
  await expect.poll(ticks, { timeout: 90_000 }).toBeGreaterThan(before);
  await expect(watchers.getByText(/^Running · /u)).toBeVisible();
  expect(pidOf(String(await path.textContent()))).toBe(first);
  await expect(log.getByText(/Started again/u)).toBeHidden();

  // With every process of the group gone and no exit status, HUI starts it again under a new PID.
  process.kill(-first, "SIGKILL");
  await expect.poll(async () => pidOf(String(await path.textContent())), { timeout: 90_000 }).not.toBe(first);
  const second = pidOf(String(await path.textContent()));
  await expect(watchers.getByText(/^Running · /u)).toBeVisible();
  await expect.poll(async () => hui.textOf(log), { timeout: 90_000 })
    .toMatch(/\[HUI\] Started again at \S+: its processes were gone with no exit status\./u);
  await expect(watchers.getByText("Keeps running: HUI starts it again if it dies. Stop ends it.")).toBeVisible();

  // Stop ends it for good: the row is Stopped, its processes are gone and Restart replaces Stop.
  await screen.getByRole("button", "Stop").tap();
  await expect.poll(async () => hui.textOf(watchers), { timeout: 90_000 }).toContain("Stopped · ");
  await expect.poll(async () => alive(second), { timeout: 90_000 }).toBe(false);
  await expect(screen.getByRole("button", "Stop")).toBeHidden();
  await expect(watchers.getByRole("button", "Restart")).toBeVisible();
  await expect.poll(async () => hui.textOf(transcript), { timeout: 90_000 }).toContain("Watch the deploy");
});
