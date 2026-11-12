/** The thinking picker's Autonomy choice stays with the session, starts New Session in it, and hands each stop of the
 * session to the Chief of Staff (CHAT-087). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

const reply = (text: string) => `E2E_REPLY:${Buffer.from(text, "utf8").toString("base64url")}`;

type Bots = { bots: Array<{ id: string; name: string; sessionId: string }> };
type Listed = { groups: Array<{ sessions: Array<{ id: string; title: string; status: string }> }> };

test("Autonomous is chosen in the thinking picker, stays with the session, and its plan reaches the Chief of Staff", { tags: ["CHAT-087"], platforms: ["web"] }, async ({ screen, hui }) => {
  const chief = (await hui.api<Bots>("GET", "/__hui/bots")).bots.find((bot) => bot.name === "Chief of Staff")!;
  const { id } = await hui.createSession({ title: "Autonomy plan" });
  try {
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

    await hui.open(`/sessions/${id}`);
    await screen.getByLabel("Thinking: high, autonomous").tap();
    await screen.getByLabel("Autonomy").getByText("Ask me").tap();
    await expect(screen.getByLabel("Thinking: high")).toBeVisible();
  } finally {
    await expect.poll(async () => (await hui.api<Listed>("GET", "/__hui/sessions")).groups.flatMap((group) => group.sessions)
      .find((session) => session.id === chief.sessionId)?.status, { timeout: 30_000 }).toBe("idle");
    await hui.api("PATCH", `/__hui/sessions/${chief.sessionId}`, { unread: false });
    await hui.api("DELETE", `/__hui/sessions/${id}`);
  }
});

test("New Session starts a session in Autonomous mode", { tags: ["CHAT-087"], platforms: ["web"] }, async ({ screen, hui }) => {
  const chief = (await hui.api<Bots>("GET", "/__hui/bots")).bots.find((bot) => bot.name === "Chief of Staff")!;
  await hui.open("/");
  await screen.getByPlaceholder("~/").fill(hui.workspace);
  await screen.getByPlaceholder("What should this session work on?").fill("Start on Autonomous");
  await screen.getByLabel(/^Thinking: /u).tap();
  await screen.getByLabel("Autonomy").getByText("Autonomous").tap();
  await expect(screen.getByLabel(/^Thinking: .+, autonomous$/u)).toBeVisible();
  await screen.getByRole("button", "Start session").tap();

  await expect(screen.getByTestId("transcript").getByText("Fixture response.")).toBeVisible();
  await expect(screen.getByLabel(/^Thinking: .+, autonomous$/u)).toBeVisible();
  const started = (await hui.api<Listed>("GET", "/__hui/sessions")).groups.flatMap((group) => group.sessions)
    .find((session) => session.title === "Start on Autonomous")!;
  await expect.poll(async () => (await hui.stored(`[Start on Autonomous](/sessions/${started.id}?open=app)`)).length, { timeout: 30_000 }).toBeGreaterThan(0);
  await expect.poll(async () => (await hui.api<Listed>("GET", "/__hui/sessions")).groups.flatMap((group) => group.sessions)
    .find((session) => session.id === chief.sessionId)?.status, { timeout: 30_000 }).toBe("idle");
  await hui.api("PATCH", `/__hui/sessions/${chief.sessionId}`, { unread: false });
  await hui.api("DELETE", `/__hui/sessions/${started.id}`);
});
