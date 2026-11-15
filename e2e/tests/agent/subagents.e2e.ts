/** An agent's spawned children: the card above the composer and the nested sidebar row, the child's own transcript and
 * the way back, and the completion card a finished child leaves in its parent (AGENT-022, AGENT-023, AGENT-024). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";
import { expectChatTitle } from "../sess/chat-header.ts";
import { openHelpers } from "./run-status.ts";

const spawn = (input: Record<string, unknown>) =>
  `E2E_CALL:${Buffer.from(JSON.stringify({ name: "sessions_spawn", input })).toString("base64url")}`;

const SLOW = { task: "E2E_SUBAGENT_CHILD_SLOW", label: "Slow verifier" };

test("a spawned child nests under its parent in the sidebar and runs on while the parent is idle", { tags: ["AGENT-022"] }, async ({ screen, hui }) => {
  const session = await hui.createSession({ title: "Spawn parent" });
  await hui.open(`/sessions/${session.id}`);
  await hui.prompt(session, spawn(SLOW));

  // One child is its own row in the Helpers section of Run status, above the composer.
  const helpers = await openHelpers(screen);
  await expect.poll(async () => hui.textOf(helpers)).toContain(SLOW.label);
  expect((await helpers.boundingBox())!.y).toBeLessThan((await screen.getByLabel("Message").boundingBox())!.y);
  await expect(helpers.getByText("1 running · 0 queued · 0 failed or stopped")).toBeVisible();
  // The parent has finished its turn; the child keeps running on its own.
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();
  await expect(helpers.getByText("1 running · 0 queued · 0 failed or stopped")).toBeVisible();

  // The sidebar nests it under the parent, behind the parent's own disclosure.
  await hui.sessionList();
  await expect(screen.getByLabel(/^Spawn parent, status idle,/u)).toBeVisible();
  await screen.getByRole("button", "Expand subagents of Spawn parent").tap();
  await expect(screen.getByLabel(/^Slow verifier, status (running|idle|waiting),/u)).toBeVisible();

  // Once it ends, the Helpers section folds into one completed row, which still opens it. A phone still holds the
  // drawer over the chat, so activating the parent's row is what returns to it.
  await hui.activateSidebarRow("Spawn parent");
  const completedHelpers = await openHelpers(screen);
  await expect(completedHelpers.getByText("1 completed")).toBeVisible();
  await completedHelpers.getByText("1 completed").tap();
  const row = completedHelpers.getByRole("button", { name: /^Open subagent Slow verifier, .+$/u });
  await expect(row).toBeVisible();
  await expect(row).toContainText("Slow verifier result: all checks passed.");
});

test("a child's card opens its own transcript, which names the parent session, and Open parent goes back", { tags: ["AGENT-023"] }, async ({ screen, hui }) => {
  const transcript = screen.getByTestId("transcript");
  const session = await hui.createSession({ title: "Subagent parent" });
  await hui.open(`/sessions/${session.id}`);
  await hui.prompt(session, spawn(SLOW));

  const helpers = await openHelpers(screen);
  await expect.poll(async () => hui.textOf(helpers)).toContain(SLOW.label);
  const row = helpers.getByRole("button", { name: /^Open subagent Slow verifier(, .+)?$/u });
  await expect(row).toBeVisible();
  await row.tap();

  await expectChatTitle(screen, SLOW.label);
  await expect.poll(async () => hui.textOf(screen.getByTestId("chat-header").filter({ hasText: SLOW.label }).last())).toContain("Subagent");
  // Its first turn is the task, attributed to the parent session, which the header links to.
  await expect(transcript.getByText(SLOW.task)).toBeVisible();
  await hui.expectLinkTo(transcript, "Subagent parent", `/sessions/${session.id}`);

  await screen.getByRole("button", { name: "Open parent" }).tap();
  await expectChatTitle(screen, "Subagent parent");
  await expect(transcript.getByText(/^tool answered: .*"label": "Slow verifier"/su)).toBeVisible();
  const reopened = await openHelpers(screen);
  const completed = reopened.getByText("1 completed");
  await expect(completed).toBeVisible();
  await completed.tap();
  await expect(reopened.getByText(SLOW.label).first()).toBeVisible();
});

test("a finished child lands as a system card, siblings arrive as one card, and the parent continues on it", { tags: ["AGENT-024"] }, async ({ screen, hui }) => {
  const transcript = screen.getByTestId("transcript");
  const session = await hui.createSession({ title: "Completion parent" });
  await hui.open(`/sessions/${session.id}`);
  await hui.prompt(session, "E2E_SUBAGENTS_START");

  const single = transcript.getByLabel("Subagent finished: Fixture researcher");
  await expect(single).toBeVisible();
  await expect(single.getByText("Automated result · delivered to pi")).toBeVisible();
  // Never a message from the operator.
  await expect(single.getByText("You")).toHaveCount(0);
  const child = single.getByRole("button", { name: /^Open subagent Fixture researcher, \d+[sm]? ?\d*[sm]?$/u });
  await expect(child).toBeVisible();
  await expect(child).toContainText("Subagent child result: the fixture contract is working.");
  await expect(transcript.getByText("Parent reviewed 1 subagent result(s) against the task and continued on its own.")).toBeVisible();

  // Two ordinary siblings are batched until the last one ends, so one card carries both.
  await hui.prompt(session, "E2E_SUBAGENTS_MULTI");
  const batch = transcript.getByLabel("2 subagents finished");
  await expect(batch).toBeVisible();
  await expect(batch.getByText("Automated result · delivered to pi")).toBeVisible();
  await expect(batch.getByText("You")).toHaveCount(0);
  const quick = batch.getByRole("button", { name: /^Open subagent Quick researcher, /u });
  const slow = batch.getByRole("button", { name: /^Open subagent Slow verifier, /u });
  await expect(quick).toContainText("Subagent child result: the fixture contract is working.");
  await expect(slow).toContainText("Slow verifier result: all checks passed.");
  await expect(transcript.getByText("Parent reviewed 2 subagent result(s) against the task and continued on its own.")).toBeVisible();

  // Each row opens its own child.
  await slow.tap();
  await expectChatTitle(screen, "Slow verifier");
  await expect(transcript.getByText("E2E_SUBAGENT_CHILD_SLOW")).toBeVisible();
  await screen.getByRole("button", { name: "Open parent" }).tap();
  await expect(batch).toBeVisible();
});
