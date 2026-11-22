/** An agent coordinating with its own session tree: listing it, reading a child's history, sending a message whose reply
 * comes back, cancelling a child, and finding a session outside the tree out of reach (AGENT-028). */
import { expect } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";

const call = (name: string, input: Record<string, unknown>) => ({ name, input });
const calls = (...list: { name: string; input: Record<string, unknown> }[]) =>
  `E2E_CALL:${Buffer.from(JSON.stringify(list)).toString("base64url")}`;

const childId = async (hui: Hui, parent: string, title: string) =>
  (await hui.api<{ groups: { sessions: { id: string; parentId?: string; title: string }[] }[] }>("GET", "/__hui/sessions"))
    .groups.flatMap(({ sessions }) => sessions).find((session) => session.parentId === parent && session.title === title)?.id;

test("an agent lists its tree, reads and messages a child, cancels one, and cannot reach outside it", { tags: ["AGENT-028"] }, async ({ screen, hui }) => {
  const transcript = screen.getByTestId("transcript");
  const session = await hui.createSession({ title: "Coordinator" });
  await hui.open(`/sessions/${session.id}`);
  await hui.prompt(session, calls(call("sessions_spawn", { task: "E2E_SUBAGENT_CHILD", label: "Researcher" })));
  await expect(transcript.getByLabel("Subagent finished: Researcher")).toBeVisible();
  const researcher = await childId(hui, session.id, "Researcher");

  await hui.prompt(session, calls(call("sessions_list", {})));
  await expect(transcript.getByText(/^tool answered: .*"label": "Researcher"/su)).toBeVisible();
  await hui.prompt(session, calls(call("sessions_history", { sessionKey: researcher, limit: 20 })));
  await expect(transcript.getByText(/^tool answered: .*Subagent child result: the fixture contract is working\./su)).toBeVisible();

  // The child's reply comes back to the agent that sent the message.
  await hui.prompt(session, calls(call("sessions_send", { sessionKey: researcher, message: "E2E_CROSS_SESSION", timeoutSeconds: 30 })));
  await expect(transcript.getByText(/^tool answered: .*Cross-session reply from child\./su)).toBeVisible();

  // In the child's own transcript the message is the parent session's, with a link back to it.
  await hui.sessionList();
  await screen.getByRole("button", { name: "Expand subagents of Coordinator" }).tap();
  await screen.getByLabel(/^Researcher, status /u).tap();
  await expect(transcript.getByText("E2E_CROSS_SESSION")).toBeVisible();
  // The message row names the parent session, and links back to it.
  await expect(transcript.getByRole("link", { name: "Coordinator" }).last()).toHaveAttribute("href", `/sessions/${session.id}`);
  await screen.getByRole("button", { name: "Open parent" }).tap();

  // It cancels a child of its own, which the child's card reads.
  await hui.prompt(session, calls(call("sessions_spawn", { task: "E2E_SUBAGENT_CHILD_SLOW", label: "Doomed helper" })));
  await expect.poll(async () => childId(hui, session.id, "Doomed helper")).toBeDefined();
  await hui.prompt(session, calls(call("subagents", { action: "kill", target: await childId(hui, session.id, "Doomed helper") })));
  // The cancelled child's card and its completion card both read why it ended.
  await expect(transcript.getByLabel("Subagent finished: Doomed helper").getByText("Cancelled by another agent.")).toBeVisible();

  // A session outside the tree stays out of reach.
  const outsider = await hui.createSession({ title: "Outsider" });
  await hui.prompt(session, calls(call("sessions_send", { sessionKey: outsider.id, message: "Hello", timeoutSeconds: 5 })));
  await expect(transcript.getByText(`Session ${outsider.id} is outside the current agent tree.`, { exact: false })).toBeVisible();
});
