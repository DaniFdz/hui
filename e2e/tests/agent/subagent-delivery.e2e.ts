/** A collected helper's result reaches its parent once: an ordinary completion card when no wait returned it, and never
 * twice when a wait did (AGENT-035). */
import { expect } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";

const call = (name: string, input: Record<string, unknown>) => ({ name, input });
const calls = (...list: { name: string; input: Record<string, unknown> }[]) =>
  `E2E_CALL:${Buffer.from(JSON.stringify(list)).toString("base64url")}`;

const childId = async (hui: Hui, parent: string, title: string) =>
  (await hui.api<{ groups: { sessions: { id: string; parentId?: string; title: string }[] }[] }>("GET", "/__hui/sessions"))
    .groups.flatMap(({ sessions }) => sessions).find((session) => session.parentId === parent && session.title === title)?.id;

test("a collected helper no wait returned is delivered as a completion card, and a returned result never arrives twice", { tags: ["AGENT-035"] }, async ({ screen, hui }) => {
  const transcript = screen.getByTestId("transcript");
  const session = await hui.createSession({ title: "Collected delivery" });
  await hui.open(`/sessions/${session.id}`);

  // Collected, but no wait ever returned it: once the parent is idle again, its result arrives as an ordinary card.
  await hui.prompt(session, calls(call("sessions_spawn", { task: "E2E_SUBAGENT_CHILD", label: "Unwaited helper", collect: true })));
  const unwaited = transcript.getByLabel("Subagent finished: Unwaited helper");
  await expect(unwaited).toBeVisible();
  await expect(unwaited.getByText("Automated result · delivered to pi")).toBeVisible();
  await expect(transcript.getByText("Parent reviewed 1 subagent result(s) against the task and continued on its own.")).toBeVisible();

  // Collected by a wait this time: its result was returned to the parent, so it is not delivered a second time.
  await hui.prompt(session, calls(call("sessions_spawn", { task: "E2E_SUBAGENT_CHILD_SLOW", label: "Waited helper", collect: true })));
  await expect.poll(async () => childId(hui, session.id, "Waited helper")).toBeDefined();
  await hui.prompt(session, calls(call("agents_wait", { ids: [await childId(hui, session.id, "Waited helper")], timeoutSeconds: 120 })));

  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();
  await expect(transcript.getByText(/^tool answered: .*Slow verifier result: all checks passed\./su)).toBeVisible();
  await expect(transcript.getByLabel("Subagent finished: Waited helper")).toHaveCount(0);
  await expect(unwaited).toBeVisible();
});
