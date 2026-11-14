/** The thinking picker's Autonomy choice stays with the session, starts New Session in it, reaches a worker, and a
 * session a Chief of Staff starts runs Autonomous and reports its stops to that chief (CHAT-088). */
import { expect } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";

const GROUP = "Autonomy E2E";

const call = (name: string, input: unknown) => `E2E_CALL:${Buffer.from(JSON.stringify({ name, input })).toString("base64url")}`;

const reply = (text: string) => `E2E_REPLY:${Buffer.from(text, "utf8").toString("base64url")}`;

/** The plan card an Autonomous session shows its operator for a screen change: the current screen and the planned one. */
const PLAN = `<div id="plan">
<h3>The thinking picker, before and after</h3>
<div class="pair">
<div class="screen"><h4>Before</h4><p>Speed: Fast</p><p>Effort: High</p></div>
<div class="screen"><h4>After</h4><p>Speed: Fast</p><p>Effort: High</p><p>Autonomy: Autonomous</p></div>
</div>
</div>`;

/** What the session says after showing the card: the short plan and the one question that asks for approval. */
const PLAN_QUESTION = "Before, the picker ends at Effort. After, Autonomy sits under Speed with Autonomous chosen. Evidence: typecheck, build, session and worker tests. Risks: a chief-started session keeps its plan as text. Stops at a draft pull request. Approve this plan, or tell me what to change?";

const say = (text: string) => `E2E_SAY:${Buffer.from(text, "utf8").toString("base64url")}`;

type Listed = { groups: Array<{ sessions: Array<{ id: string; title: string; status: string }> }> };
type Bots = { bots: Array<{ id: string; name: string; sessionId: string }> };

const chiefIdle = (hui: Hui, chief: { sessionId: string }) => expect.poll(async () => (await hui.api<Listed>("GET", "/__hui/sessions"))
  .groups.flatMap((group) => group.sessions).find((session) => session.id === chief.sessionId)?.status, { timeout: 30_000 }).toBe("idle");

test("Autonomous is chosen in the thinking picker, stays with the session, and reports in its own chat", { tags: ["CHAT-088"], platforms: ["web"] }, async ({ screen, hui }) => {
  const chief = (await hui.api<Bots>("GET", "/__hui/bots")).bots.find((bot) => bot.name === "Chief of Staff")!;
  const { id } = await hui.createSession({ title: "Autonomy plan" });
  await hui.open(`/sessions/${id}`);
  await screen.getByLabel(/^Thinking: /u).tap();
  await screen.getByLabel("Autonomy").getByText("Autonomous").tap();
  await expect(screen.getByLabel("Thinking: high, autonomous")).toBeVisible();
  await hui.reload();
  await expect(screen.getByLabel("Thinking: high, autonomous")).toBeVisible();

  await screen.getByLabel("Message").fill(`${call("show_widget", { title: "Plan: the thinking picker", widget_code: PLAN })} ${say(PLAN_QUESTION)}`);
  await screen.getByRole("button", "Send message").tap();
  await expect(screen.getByLabel("Widget: Plan: the thinking picker")).toBeVisible();
  await expect(screen.getByTestId("transcript")).toContainText("Approve this plan, or tell me what to change?");

  // The operator supervises this session, so its prompt asks for the form that explains the change, never a wall of text.
  const tools = await hui.api<{ prompt: string }>("GET", `/__hui/sessions/${id}/tools`);
  expect(tools.prompt).toContain("before/after card with `show_widget`, following the `visualize` skill");
  expect(tools.prompt).toContain("`mermaid` diagram");
  expect(tools.prompt).toContain("a short text plan is the right plan");
  expect(tools.prompt).not.toContain("A chief reads text and cannot see a widget");

  // Nothing started before the approval: the next turn answers the operator's answer.
  await screen.getByLabel("Message").fill("Approved, go ahead");
  await screen.getByRole("button", "Send message").tap();
  await expect(screen.getByTestId("transcript")).toContainText("Fixture response.");

  // The session the operator started reports in its own chat: no chief is given it.
  await hui.open(`/bots/${chief.id}`);
  await expect(screen.getByTestId("transcript").getByText(/Autonomous session "Autonomy plan"/u)).toHaveCount(0);

  await hui.open(`/sessions/${id}`);
  await screen.getByLabel("Thinking: high, autonomous").tap();
  await screen.getByLabel("Autonomy").getByText("Supervised").tap();
  await expect(screen.getByLabel("Thinking: high")).toBeVisible();
});

test("New Session starts a session on Supervised each time", { tags: ["CHAT-088"], platforms: ["web"] }, async ({ screen, hui }) => {
  await hui.open("/");
  await screen.getByPlaceholder("~/").fill(hui.workspace);
  await screen.getByPlaceholder("What should this session work on?").fill("Start on Autonomous");
  await screen.getByLabel(/^Thinking: /u).tap();
  await screen.getByLabel("Autonomy").getByText("Autonomous").tap();
  await expect(screen.getByLabel(/^Thinking: .+, autonomous$/u)).toBeVisible();
  await screen.getByRole("button", "Start session").tap();

  await expect(screen.getByTestId("transcript").getByText("Fixture response.")).toBeVisible();
  await expect(screen.getByLabel(/^Thinking: .+, autonomous$/u)).toBeVisible();

  await hui.open("/");
  await screen.getByPlaceholder("~/").fill(hui.workspace);
  await screen.getByPlaceholder("What should this session work on?").fill("Back on Supervised");
  await screen.getByLabel(/^Thinking: /u).tap();
  await expect(screen.getByLabel("Autonomy").getByText("Supervised")).toHaveAttribute("aria-checked", "true");
});

test("Autonomous mode reaches a session on a worker, and stays with it", { tags: ["CHAT-088"], platforms: ["web"] }, async ({ screen, hui }) => {
  const worker = await hui.addWorker("autonomy-box");
  const { session } = await hui.api<{ session: { id: string } }>("POST", "/__hui/sessions", { cwd: worker.home, title: "Worker autonomy", worker: worker.id });
  await hui.open(`/sessions/${session.id}`);
  await screen.getByLabel(/^Thinking: /u).tap();
  await screen.getByLabel("Autonomy").getByText("Autonomous").tap();
  await expect(screen.getByLabel(/^Thinking: .+, autonomous$/u)).toBeVisible({ timeout: 60_000 });
  await hui.reload();
  await expect(screen.getByLabel(/^Thinking: .+, autonomous$/u)).toBeVisible({ timeout: 60_000 });
});

test("a session a Chief of Staff starts runs Autonomous and its stop reaches that chief", { tags: ["CHAT-088"], platforms: ["web"] }, async ({ screen, hui }) => {
  // A chief of its own group, so the fixtures delete it and its chat with the rest of the test.
  const { bot: chief } = await hui.api<{ bot: { id: string; sessionId: string } }>("POST", "/__hui/staff/chiefs", { group: GROUP, cwd: hui.workspace });
  const find = async () => (await hui.api<Listed>("GET", "/__hui/sessions")).groups.flatMap((group) => group.sessions)
    .find((session) => session.title === "Autonomous lead");
  try {
    await hui.prompt({ id: chief.sessionId }, call("create_session", {
      prompt: reply("Ready for review: one pull request, its checks pass."),
      cwd: hui.workspace,
      title: "Autonomous lead",
      group: GROUP,
      worker: "local",
      worktree: false,
    }));
    await expect.poll(find, { timeout: 60_000 }).toBeTruthy();
    const lead = (await find())!;
    const tools = await hui.api<{ prompt: string }>("GET", `/__hui/sessions/${lead.id}/tools`);
    expect(tools.prompt).toContain("## Autonomous mode");
    expect(tools.prompt).toContain("## PR lead");
    // A chief reads text, not a widget: this session writes its plan in its reply.
    expect(tools.prompt).toContain("A chief reads text and cannot see a widget");
    expect(tools.prompt).toContain("`mermaid` diagram or a table stays readable to them");
    expect(tools.prompt).not.toContain("before/after card with `show_widget`");

    await hui.open(`/bots/${chief.id}`);
    await expect(screen.getByTestId("transcript")).toContainText(/Autonomous session "Autonomous lead" is idle; decide the next step/u);
    await expect(screen.getByTestId("transcript")).toContainText(/It runs Autonomous and reports to you/u);
    await chiefIdle(hui, chief);
    await hui.api("PATCH", `/__hui/sessions/${chief.sessionId}`, { unread: false });
  } finally {
    const lead = await find();
    if (lead) await hui.api("DELETE", `/__hui/sessions/${lead.id}`);
  }
});
