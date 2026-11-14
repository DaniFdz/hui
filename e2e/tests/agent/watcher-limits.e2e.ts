/** An agent's watchers at their limits: the tenth slot, the agent's own dismiss, the refusals that keep a watcher's
 * definition honest, and a keep-running watcher that starts itself again when all its processes die (AGENT-041,
 * AGENT-042). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";
import { openWatchers } from "./run-status.ts";

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

test("a conversation at ten watchers refuses a new one, and the agent's own dismiss frees a slot without a reload", { tags: ["AGENT-041"], platforms: ["web"] }, async ({ screen, hui }) => {
  const transcript = screen.getByTestId("transcript");
  const session = await hui.createSession({ title: "Watcher limit" });
  await hui.open(`/sessions/${session.id}`);

  // Ten in one turn: one that finishes at once, and nine that keep running.
  await hui.prompt(session, watcher([
    start("Settled watcher", "printf 'settled\\n'"),
    ...Array.from({ length: 9 }, (_, index) => start(`Wait ${index + 1}`, "sleep 600")),
  ]));
  const watchers = await openWatchers(screen);
  await expect(watchers.getByText("9 running", { exact: true })).toBeVisible({ timeout: 90_000 });
  await watchers.getByText(/^Watcher details/u).tap();

  // The cap holds: a new start fails with what to do about it.
  await hui.prompt(session, watcher([start("One too many", "sleep 600")]));
  await expect(transcript.getByText(/This conversation already has 10 watchers\. Dismiss finished ones first\./u)).toBeVisible();

  // Dismissing a running watcher is refused, and a restart cannot rewrite a watcher's command.
  await watchers.getByText("Wait 1").tap();
  const runningId = idOf(String(await watchers.getByText(/^PID \d+ · .+\.log$/u).textContent()));
  await watchers.getByText("Wait 1").tap();
  await hui.prompt(session, watcher([{ action: "dismiss", id: runningId }]));
  await expect(transcript.getByText(/Stop the watcher before dismissing it\./u)).toBeVisible();
  await hui.prompt(session, watcher([{ action: "restart", id: runningId, command: "printf 'something else\\n'" }]));
  await expect(transcript.getByText(/restart re-runs the recorded command and takes only an id\. To run something else, start a new watcher\./u)).toBeVisible();

  // The settled one can be dismissed by the agent, and the summary follows without a reload.
  await watchers.getByText("Settled watcher").tap();
  await expect(watchers.getByText(/^Done · /u)).toBeVisible({ timeout: 90_000 });
  const settledId = idOf(String(await watchers.getByText(/^PID \d+ · .+\.log$/u).textContent()));
  await watchers.getByText("Settled watcher").tap();
  await hui.prompt(session, watcher([{ action: "dismiss", id: settledId }]));
  await expect(watchers.getByText("Settled watcher")).toBeHidden();
  await expect(watchers.getByText("9 running", { exact: true })).toBeVisible();

  // The freed slot takes the new watcher, in the same list.
  await hui.prompt(session, watcher([start("One too many", "sleep 600")]));
  await expect(watchers.getByText("10 running", { exact: true })).toBeVisible();
  await expect(watchers.getByText("One too many")).toBeVisible();
});

test("a keep-running watcher survives its shell, starts again with a new PID when all its processes die, and Stop ends it", { tags: ["AGENT-042"], platforms: ["web"] }, async ({ screen, hui }) => {
  const transcript = screen.getByTestId("transcript");
  const session = await hui.createSession({ title: "Keep-running watcher" });
  await hui.open(`/sessions/${session.id}`);
  const ticks = async () => (await hui.textOf(log)).split("tick").length - 1;

  await hui.prompt(session, watcher([start("Watch the deploy", "i=0; while true; do i=$((i+1)); printf 'tick %s\\n' \"$i\"; sleep 1; done", { keepRunning: true })]));
  const watchers = await openWatchers(screen);
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
