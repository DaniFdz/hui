/** Who sent a message: a bot's own words in a session, a session's, a routine's and a trigger's in a bot's chat, and
 * what an agent handed a bot kept in sight (CHAT-056, CHAT-057, CHAT-058). */
import { expect } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";
import { panelOverview } from "../bot/bot-panel.ts";

const call = (name: string, input: unknown) => `E2E_CALL:${Buffer.from(JSON.stringify({ name, input })).toString("base64url")}`;

/** A bot of this HUI, whose chat the fixture answers. */
const createBot = async (hui: Hui, name: string) =>
  (await hui.api<{ bot: { id: string; handle: string; sessionId: string } }>("POST", "/__hui/bots", { name, soul: `# Who I am\nA fixture bot.\n` })).bot;

test("a bot's message sits on the left under its name, opens its chat, copies and replies with its own text, offers no Rewind and follows a new color without a reload", { tags: ["CHAT-056"], platforms: ["web"] }, async ({ screen, hui }) => {
  await hui.clipboard();
  const bot = await createBot(hui, "Grace");
  await hui.api("PATCH", `/__hui/bots/${bot.id}`, { avatar: { color: "#3cb371" } });
  const session = await hui.createSession({ title: "Grace reports in" });
  const report = "Grace reports back\n\n```\nconst answer = 42;\n```";
  await hui.open(`/sessions/${session.id}`);
  const transcript = screen.getByTestId("transcript", { visible: true });
  const idle = screen.getByLabel("Session status: Idle");
  await expect(idle).toBeVisible();

  // The session tags Grace, and Grace answers into the session: the bot's words arrive as hers, not the operator's.
  await hui.prompt(session, call("message_bot", { to: `@${bot.handle}`, message: call("message_bot", { to: `agent:${session.id}`, message: report }) }));
  await expect(transcript.getByText("const answer = 42;")).toBeVisible();
  await expect(idle).toBeVisible();
  const name = transcript.getByRole("link", { name: "Grace" });
  await expect(name).toBeVisible();
  await expect(name).toHaveAttribute("href", `/bots/${bot.id}`);
  // The bubble is the rendered message itself, without the [from @grace] header the model wrote.
  await expect(transcript.getByText("Grace reports back")).toBeVisible();
  await expect(transcript.getByText(/\[from @/u)).toHaveCount(0);
  // The rail names who it came from, and only the operator's own prompt offers a rewind.
  await expect(screen.getByRole("button", { name: /^From @grace, marker \d+ of \d+$/u })).toBeVisible();
  await expect(screen.getByLabel("Rewind to here")).toHaveCount(1);

  // Copy and Reply take the bot's own words, never its return address.
  await hui.messageActions(transcript.getByText("Grace reports back"));
  await screen.getByRole("button", "Copy message").tap();
  await expect.poll(() => hui.copied()).toBe(report);
  // The reply that belongs to the bot's message is the one drawn on the line its name is under: every row has its own.
  const line = (await name.boundingBox())!.y;
  const replies = await screen.getByRole("button", "Reply to message").all();
  const onBotsLine = [];
  for (const [at, reply] of replies.entries()) if (Math.abs((await reply.boundingBox())!.y - line) < 30) onBotsLine.push(at);
  expect(onBotsLine).toHaveLength(1);
  await replies[onBotsLine[0]!]!.tap();
  await expect(screen.getByLabel("Message")).toHaveValue(/^> Grace reports back\n> \n> ```\n> const answer = 42;\n> ```/u);

  // A new color reaches the open chat without a reload.
  const before = (await hui.look(name)).color;
  await hui.api("PATCH", `/__hui/bots/${bot.id}`, { avatar: { color: "#8a7cf0" } });
  await expect.poll(async () => (await hui.look(name)).color).not.toEqual(before);
});

test("a bot's chat shows a session's message under its chat icon and title, a routine's under its name and Routine, and a trigger's under its name and summary", { tags: ["CHAT-057"], platforms: ["web"] }, async ({ screen, hui }) => {
  const bot = await createBot(hui, "Ada");
  const session = await hui.createSession({ title: "Tag Ada" });
  await hui.api("POST", "/__hui/automation/tasks", {
    name: "Morning check", sessionId: bot.sessionId, prompt: "Check the build.", enabled: true,
    schedule: { kind: "cron", expression: "0 8 * * *", timezone: "UTC" },
  });
  const { hook } = await hui.api<{ hook: { path: string } }>("POST", `/__hui/bots/${bot.id}/triggers`, { name: "Reviews", prompt: "Look at it.", cooldownSeconds: 0 });
  await hui.open(`/bots/${bot.id}`);
  const transcript = screen.getByTestId("transcript", { visible: true });
  const idle = screen.getByLabel("Session status: Idle");
  await expect(idle).toBeVisible();

  // A session's tag arrives in the bot's chat under the session that sent it, and opens that session.
  await hui.prompt(session, call("message_bot", { to: `@${bot.handle}`, message: "Please watch PR #7." }));
  const fromSession = transcript.getByRole("link", { name: "Tag Ada" });
  await expect(fromSession).toBeVisible();
  await expect(fromSession).toHaveAttribute("href", `/sessions/${session.id}`);
  await expect(transcript.getByText("Please watch PR #7.")).toBeVisible();

  // A routine's run arrives as the routine, and a trigger's event as the trigger with its summary.
  await panelOverview(screen, "Ada");
  await screen.getByRole("button", "Add routine").tap();
  await screen.getByRole("button", "Run now: Morning check").tap();
  await expect(transcript.getByText("Morning check")).toBeVisible();
  await expect(transcript.getByText("Routine")).toBeVisible();
  await hui.api("POST", hook.path, { events: [{ id: "one", summary: "review one", details: "RAW one", at: new Date().toISOString() }] });
  await expect(transcript.getByText("Reviews")).toBeVisible();
  await expect(transcript.getByText("review one")).toBeVisible();
  await expect(idle).toBeVisible();
  // None of the three was the operator's own: nothing of theirs is offered a rewind.
  await expect(screen.getByLabel("Rewind to here")).toHaveCount(0);
});

test("what an agent handed a bot keeps its own row with the bot's face and the message's first line, unfolds to the whole message, and says when it was not sent", { tags: ["CHAT-058"], platforms: ["web"] }, async ({ screen, hui }) => {
  const bot = await createBot(hui, "Grace");
  const brief = "Grace, please watch PR #7.\n\nThe whole brief, which the row keeps for when it opens.";
  const session = await hui.createSession({ title: "Hands work over" });
  await hui.open(`/sessions/${session.id}`);
  const transcript = screen.getByTestId("transcript", { visible: true });
  const idle = screen.getByLabel("Session status: Idle");
  await expect(idle).toBeVisible();

  await hui.prompt(session, call("message_bot", { to: `@${bot.handle}`, message: brief }));
  await expect(transcript.getByText(/^tool answered: /u)).toBeVisible();
  await expect(idle).toBeVisible();
  // The turn folds its tool call, and the hand-off keeps a row of its own: to whom, and the message's first line.
  const sent = transcript.getByText("Sent to Grace", { exact: true });
  await expect(sent).toBeVisible();
  await expect(transcript.getByText("Grace, please watch PR #7.", { exact: true, visible: true })).toBeVisible();
  await expect(transcript.getByText(/The whole brief, which the row keeps/u)).toBeHidden();
  await sent.tap();
  await expect(transcript.getByText(/The whole brief, which the row keeps for when it opens\./u, { visible: true })).toBeVisible();

  // A hand-off the gateway refused says so in its own row, with the reason it gave.
  const refused = await hui.createSession({ title: "Hands work to nobody" });
  await hui.open(`/sessions/${refused.id}`);
  await hui.prompt(refused, call("message_bot", { to: "@nobody", message: "Nobody will read this." }));
  await expect(idle).toBeVisible();
  const notSent = transcript.getByText("Not sent to @nobody", { exact: true });
  await expect(notSent).toBeVisible();
  await notSent.tap();
  await expect(transcript.getByText(/^No bot is called "@nobody"\./u, { visible: true })).toBeVisible();
});
