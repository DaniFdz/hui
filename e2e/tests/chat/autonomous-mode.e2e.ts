/** The thinking picker's Autonomy choice stays with the session, starts New Session in it, reaches a worker, and hands
 * each stop of the session to its group's Chief of Staff (CHAT-087). */
import { expect } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";

const GROUP = "Autonomy E2E";

const reply = (text: string) => `E2E_REPLY:${Buffer.from(text, "utf8").toString("base64url")}`;

type Listed = { groups: Array<{ sessions: Array<{ id: string; status: string }> }> };

const chiefIdle = (hui: Hui, chief: { sessionId: string }) => expect.poll(async () => (await hui.api<Listed>("GET", "/__hui/sessions"))
  .groups.flatMap((group) => group.sessions).find((session) => session.id === chief.sessionId)?.status, { timeout: 30_000 }).toBe("idle");

test("Autonomous is chosen in the thinking picker, stays with the session, and its plan reaches its group's chief", { tags: ["CHAT-087"], platforms: ["web"] }, async ({ screen, hui }) => {
  const { bot: chief } = await hui.api<{ bot: { id: string; sessionId: string } }>("POST", "/__hui/staff/chiefs", { group: GROUP, cwd: hui.workspace });
  const { id } = await hui.createSession({ title: "Autonomy plan", group: GROUP });
  await hui.open(`/sessions/${id}`);
  await screen.getByLabel(/^Thinking: /u).tap();
  await screen.getByLabel("Autonomy").getByText("Autonomous").tap();
  await expect(screen.getByLabel("Thinking: high, autonomous")).toBeVisible();
  await hui.reload();
  await expect(screen.getByLabel("Thinking: high, autonomous")).toBeVisible();

  await screen.getByLabel("Message").fill(reply("Plan: one toggle in one pull request.\n\nAccept this plan?"));
  await screen.getByRole("button", "Send message").tap();
  await expect(screen.getByTestId("transcript").getByText("Accept this plan?")).toBeVisible();

  await hui.open(`/bots/${chief.id}`);
  await expect(screen.getByTestId("transcript").getByText(/Autonomous session "Autonomy plan" is idle and waiting for a decision/u)).toBeVisible();
  await expect(screen.getByTestId("transcript").getByText(/It runs in Autonomous mode and reports to you/u)).toBeVisible();
  await chiefIdle(hui, chief);

  await hui.open(`/sessions/${id}`);
  await screen.getByLabel("Thinking: high, autonomous").tap();
  await screen.getByLabel("Autonomy").getByText("Ask me").tap();
  await expect(screen.getByLabel("Thinking: high")).toBeVisible();
});

test("New Session starts a session in Autonomous mode, and its first stop reaches its group's chief", { tags: ["CHAT-087"], platforms: ["web"] }, async ({ screen, hui }) => {
  const { bot: chief } = await hui.api<{ bot: { id: string; sessionId: string } }>("POST", "/__hui/staff/chiefs", { group: GROUP, cwd: hui.workspace });
  await hui.createSession({ title: "Autonomy anchor", group: GROUP });
  await hui.open("/");
  await hui.peek(screen.getByText(GROUP.toUpperCase(), { exact: true, visible: true }));
  await screen.getByRole("button", `New session in ${GROUP.toUpperCase()}`).tap();
  await screen.getByPlaceholder("What should this session work on?").fill("Start on Autonomous");
  await screen.getByLabel(/^Thinking: /u).tap();
  await screen.getByLabel("Autonomy").getByText("Autonomous").tap();
  await expect(screen.getByLabel(/^Thinking: .+, autonomous$/u)).toBeVisible();
  await screen.getByRole("button", "Start session").tap();

  await expect(screen.getByTestId("transcript").getByText("Fixture response.")).toBeVisible();
  await expect(screen.getByLabel(/^Thinking: .+, autonomous$/u)).toBeVisible();
  await hui.open(`/bots/${chief.id}`);
  await expect(screen.getByTestId("transcript").getByText(/Autonomous session "Start on Autonomous" is idle; decide the next step/u)).toBeVisible();
  await chiefIdle(hui, chief);
});

test("Autonomous mode reaches a session on a worker, and its stop still reaches its group's chief", { tags: ["CHAT-087"], platforms: ["web"] }, async ({ screen, hui }) => {
  const { bot: chief } = await hui.api<{ bot: { id: string; sessionId: string } }>("POST", "/__hui/staff/chiefs", { group: GROUP, cwd: hui.workspace });
  const worker = await hui.addWorker("autonomy-box");
  const { session } = await hui.api<{ session: { id: string } }>("POST", "/__hui/sessions", { cwd: worker.home, title: "Worker autonomy", group: GROUP, worker: worker.id });
  await hui.open(`/sessions/${session.id}`);
  await screen.getByLabel(/^Thinking: /u).tap();
  await screen.getByLabel("Autonomy").getByText("Autonomous").tap();
  await expect(screen.getByLabel(/^Thinking: .+, autonomous$/u)).toBeVisible({ timeout: 60_000 });
  await hui.reload();
  await expect(screen.getByLabel(/^Thinking: .+, autonomous$/u)).toBeVisible({ timeout: 60_000 });

  await screen.getByLabel("Message").fill(reply("Plan: one change on the worker.\n\nAccept this plan?"));
  await screen.getByRole("button", "Send message").tap();
  await expect(screen.getByTestId("transcript").getByText("Accept this plan?")).toBeVisible({ timeout: 60_000 });

  await hui.open(`/bots/${chief.id}`);
  await expect(screen.getByTestId("transcript").getByText(/Autonomous session "Worker autonomy" is idle and waiting for a decision/u)).toBeVisible();
  await chiefIdle(hui, chief);
});
