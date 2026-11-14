/** A parent's collected helpers as the Helpers section of Run status: its counts and rows, and a helper that got no
 * sidebar row or completion card while its parent waited (AGENT-031). A child a gateway restart interrupted is
 * `subagent-restart.e2e.ts`, which proves the run its own runtime carries on (AGENT-027). */
import { expect } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";
import { openHelpers } from "./run-status.ts";

const calls = (...list: { name: string; input: Record<string, unknown> }[]) =>
  `E2E_CALL:${Buffer.from(JSON.stringify(list)).toString("base64url")}`;
const call = (name: string, input: Record<string, unknown>) => ({ name, input });
/** A child whose task holds a tool call, so it is still running until the test releases the fixture. */
const HELD_TASK = `E2E_HOLD:${Buffer.from(JSON.stringify({ name: "fixture_echo", input: { text: "waiting" } })).toString("base64url")}`;

/** The child session ids the spawns returned, which are the ids `agents_wait` takes. */
const children = async (hui: Hui, parent: string) =>
  (await hui.api<{ groups: { sessions: { id: string; parentId?: string }[] }[] }>("GET", "/__hui/sessions"))
    .groups.flatMap(({ sessions }) => sessions).filter(({ parentId }) => parentId === parent).map(({ id }) => id);

test("helpers wait in one Helpers section that counts them and lists them, without a sidebar row or a completion card", { tags: ["AGENT-031"], platforms: ["web"] }, async ({ screen, hui }) => {
  const transcript = screen.getByTestId("transcript");
  const session = await hui.createSession({ title: "Parallel card" });
  await hui.open(`/sessions/${session.id}`);

  // Two collected helpers that stay running.
  await hui.prompt(session, calls(
    call("sessions_spawn", { task: HELD_TASK, label: "First helper", collect: true }),
    call("sessions_spawn", { task: HELD_TASK, label: "Second helper", collect: true }),
  ));
  await expect.poll(async () => (await children(hui, session.id)).length).toBe(2);

  // The Helpers section names the batch, how far it got and what each state is.
  const helpers = await openHelpers(screen);
  await expect(helpers.getByText("Helpers", { exact: true })).toBeVisible();
  await expect(helpers.getByText("0 of 2")).toBeVisible();
  await expect(helpers.getByText("2 running · 0 queued · 0 failed or stopped")).toBeVisible();
  const first = helpers.getByRole("button", { name: /^Open subagent First helper, .+$/u });
  const second = helpers.getByRole("button", { name: /^Open subagent Second helper, .+$/u });
  await expect(first).toContainText("Running…");
  await expect(second).toContainText("Running…");

  // A helper gets no sidebar row of its own.
  await hui.sessionList();
  await expect(screen.getByLabel(/^First helper, status/u)).toHaveCount(0);
  await expect(screen.getByLabel(/^Second helper, status/u)).toHaveCount(0);
  await expect(screen.getByLabel(/^Parallel card, status/u)).toBeVisible();

  // The parent waits for them, and a helper the parent waited for arrives in the section, never as a completion card.
  await hui.open(`/sessions/${session.id}`);
  const openedHelpers = await openHelpers(screen);
  await hui.prompt(session, calls(call("agents_wait", { ids: await children(hui, session.id), timeoutSeconds: 120 })));
  await expect(screen.getByLabel("Session status: Running")).toBeVisible();
  await hui.provider.release();
  await expect(openedHelpers.getByText("2 completed")).toBeVisible({ timeout: 90_000 });
  // Success folds the batch into its summary; reopen it before reading the rows kept under that disclosure.
  const completedFirst = openedHelpers.getByRole("button", { name: /^Open subagent First helper(?:, .+)?$/u });
  if (!(await completedFirst.isVisible())) await openedHelpers.getByText("2 completed").tap();
  await expect(completedFirst).toBeVisible();
  await expect(openedHelpers.getByText("Child runs finished. Check the conversation for the final response.")).toBeVisible();
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();
  await expect(transcript.getByLabel(/subagents? finished/iu)).toHaveCount(0);

  // A helper the parent's own limit times out says so in its row.
  await hui.prompt(session, calls(call("sessions_spawn", { task: "E2E_SUBAGENT_CHILD_SLOW", label: "Timed out helper", collect: true, runTimeoutSeconds: 1 })));
  await expect(openedHelpers.getByText("0 completed · 1 failed or stopped")).toBeVisible({ timeout: 90_000 });
  const timedOut = openedHelpers.getByRole("button", { name: /^Open subagent Timed out helper(, .+)?$/u });
  await expect(timedOut).toContainText("The subagent exceeded 1 seconds.");
});
