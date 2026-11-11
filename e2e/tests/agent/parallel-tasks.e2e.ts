/** Collected helpers: the Parallel tasks card folds into one row once every helper succeeded and opens each of them, and
 * Stop on a waiting parent cancels the whole batch (AGENT-034, AGENT-033). */
import { expect } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";
import { expectChatTitle } from "../sess/chat-header.ts";

const call = (name: string, input: Record<string, unknown>) => ({ name, input });
const calls = (...list: { name: string; input: Record<string, unknown> }[]) =>
  `E2E_CALL:${Buffer.from(JSON.stringify(list)).toString("base64url")}`;

/** The child session ids the two spawns returned, which are the ids `agents_wait` takes. */
const children = async (hui: Hui, parent: string) =>
  (await hui.api<{ groups: { sessions: { id: string; parentId?: string }[] }[] }>("GET", "/__hui/sessions"))
    .groups.flatMap(({ sessions }) => sessions).filter(({ parentId }) => parentId === parent).map(({ id }) => id);

test("a batch whose helpers all succeed folds into one Parallel tasks row that still opens Child details", { tags: ["AGENT-034"] }, async ({ screen, hui }) => {
  const swarm = screen.getByLabel("Parallel tasks");
  const session = await hui.createSession({ title: "Swarm parent" });
  await hui.open(`/sessions/${session.id}`);
  await hui.prompt(session, calls(
    call("sessions_spawn", { task: "E2E_SUBAGENT_CHILD quick", label: "Quick researcher", collect: true }),
    call("sessions_spawn", { task: "E2E_SUBAGENT_CHILD_SLOW", label: "Slow verifier", collect: true }),
  ));
  await expect.poll(async () => (await children(hui, session.id)).length).toBe(2);

  // The parent waits for both, which the card shows as the batch it is still running.
  await hui.prompt(session, calls(call("agents_wait", { ids: await children(hui, session.id), timeoutSeconds: 120 })));
  await expect(swarm.getByText("Parallel tasks")).toBeVisible();

  // Every helper succeeded, so the card folds into one row and its children stay behind the disclosure.
  await expect(swarm.getByText("2 completed")).toBeVisible();
  const rows = swarm.getByRole("button", { name: /^Open subagent /u });
  await expect(rows).toHaveCount(0);

  await swarm.getByText("2 completed").tap();
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toBeVisible();
  await expect(swarm.getByText("Child runs finished. Check the conversation for the final response.")).toBeVisible();
  const quick = swarm.getByRole("button", { name: /^Open subagent Quick researcher, /u });
  const slow = swarm.getByRole("button", { name: /^Open subagent Slow verifier, /u });
  await expect(quick).toContainText("Subagent child result: the fixture contract is working.");
  await expect(slow).toContainText("Slow verifier result: all checks passed.");

  // A collected helper opens its own transcript the same way a spawned child does.
  await slow.tap();
  await expectChatTitle(screen, "Slow verifier");
  await expect(screen.getByTestId("transcript").getByText("E2E_SUBAGENT_CHILD_SLOW")).toBeVisible();
  await screen.getByRole("button", { name: "Open parent" }).tap();
  await expectChatTitle(screen, "Swarm parent");
});

test("Stop on a parent waiting for its helpers cancels the wait and every helper, and nothing follows", { tags: ["AGENT-033"] }, async ({ screen, hui }) => {
  const swarm = screen.getByLabel("Parallel tasks");
  const transcript = screen.getByTestId("transcript");
  const session = await hui.createSession({ title: "Stopped swarm" });
  await hui.open(`/sessions/${session.id}`);
  await hui.prompt(session, calls(
    call("sessions_spawn", { task: "E2E_SUBAGENT_CHILD_SLOW", label: "First helper", collect: true }),
    call("sessions_spawn", { task: "E2E_SUBAGENT_CHILD_SLOW", label: "Second helper", collect: true }),
  ));
  await expect.poll(async () => (await children(hui, session.id)).length).toBe(2);
  await hui.prompt(session, calls(call("agents_wait", { ids: await children(hui, session.id), timeoutSeconds: 120 })));

  await expect(screen.getByLabel("Session status: Running")).toBeVisible();
  await expect(swarm.getByText("Parallel tasks")).toBeVisible();
  await expect.poll(async () => hui.textOf(swarm)).toContain("0 of 2");
  await screen.getByRole("button", { name: "Stop" }).tap();

  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();
  const counts = swarm.getByText("0 completed · 2 failed or stopped");
  await expect(counts).toBeVisible();
  await counts.tap();
  const rows = swarm.getByRole("button", { name: /^Open subagent /u });
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText("Stopped with its parent.");
  await expect(rows.last()).toContainText("Stopped with its parent.");

  // A stopped batch delivers nothing back, so no completion card and no new turn.
  await expect(transcript.getByLabel(/subagents? finished/iu)).toHaveCount(0);
  await expect(transcript.getByText("Parent reviewed", { exact: false })).toHaveCount(0);
});
