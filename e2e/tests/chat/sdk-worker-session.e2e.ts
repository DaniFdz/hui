/** Working in a session on PI's SDK worker: the header names pi, thinking, a tool call and a reply all stream, a HUI
 * tool answers an extension's question, prompt-free Continue is offered while Fork from here is not, a gateway restart
 * leaves the session Cold on the Sessions page until it is opened again from its stored transcript, and Rewind moves
 * PI's branch (CHAT-065). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

const call = (name: string, input: Record<string, unknown>) => `E2E_CALL:${Buffer.from(JSON.stringify({ name, input })).toString("base64url")}`;

test("a session on PI's worker streams thinking, tools and replies, answers an extension's question, offers Continue without Fork, sits Cold after a restart until it is opened, and rewinds PI's branch", { tags: ["CHAT-065"], platforms: ["web"] }, async ({ screen, hui }) => {
  const message = screen.getByLabel("Message");
  const send = screen.getByRole("button", "Send message");
  const transcript = screen.getByTestId("transcript");
  const idle = screen.getByLabel("Session status: Idle");
  const rewind = transcript.getByRole("button", "Rewind to here");

  const session = await hui.createSession({ title: "SDK worker chat", tool: "pi" });
  await hui.open(`/sessions/${session.id}`);
  await expect(idle).toBeVisible();
  // The header names the runtime the session runs on.
  expect(await hui.textOf(screen.getByTestId("chat-header"))).toContain("pi · OTHER");

  // Thinking and the reply stream from PI's worker; the thinking folds into the turn's activity until it is opened.
  await message.fill("E2E_THINKING");
  await send.tap();
  await expect(transcript.getByText("Thought it through.")).toBeVisible();
  await expect(idle).toBeVisible();
  await hui.scrollTo(transcript, transcript.getByText("Reasoning"));
  await transcript.getByText("Reasoning").tap();
  await expect(transcript.getByText("Weighing the fixture.")).toBeVisible();

  // A tool call runs there too, and its row names the read.
  await message.fill(call("read", { path: `${hui.workspace}/fixture.txt` }));
  await send.tap();
  await expect(transcript.getByText(/^tool answered: /u)).toBeVisible();
  await expect(idle).toBeVisible();
  await hui.scrollTo(transcript, transcript.getByText("Used 1 tool"));
  const read = transcript.getByRole("button", /^Read fixture\.txt/u);
  if (!(await read.isVisible())) await transcript.getByText("Used 1 tool").tap();
  await expect(read).toBeVisible();

  // A HUI tool answers an extension's question on this runtime as it does on a Durable one.
  const card = screen.getByTestId("question-card");
  await message.fill("/hui-e2e-question select");
  await send.tap();
  await expect(card).toBeVisible();
  await expect(screen.getByLabel("Session status: Waiting for your answer")).toBeVisible();
  await card.getByText("First option", { exact: true }).tap();
  await card.getByRole("button", "Submit").tap();
  await expect(screen.getByText("Question answered: First option")).toBeVisible();
  await expect(idle).toBeVisible();

  // Continue without a prompt is PI's own resume, offered on this runtime alone; Fork from here copies a Durable
  // history, so it is never offered here.
  await expect(screen.getByRole("button", "Continue without a prompt")).toBeVisible();
  await hui.messageActions(transcript.getByText("Thought it through."));
  await expect(screen.getByRole("button", "Fork from here")).toHaveCount(0);

  // Leave through Sessions first: an open chat would reconnect after the restart and legitimately start its worker.
  await hui.sessionList();
  await screen.getByTestId("nav-item").filter({ hasText: "Sessions" }).tap();
  await expect(screen.getByTestId("page-title")).toHaveText("Sessions");
  await expect(transcript).toHaveCount(0);
  const row = screen.getByRole("row", { name: /SDK worker chat/u });
  await expect(row).toBeVisible();

  // A gateway restart leaves the session cold: the Sessions page reports no runtime for it until it is opened, and
  // opening it brings the stored transcript back.
  await hui.restartGateway();
  await hui.open("/sessions");
  await expect.poll(() => hui.textOf(row)).toContain("Cold");
  await screen.getByRole("button", "Open SDK worker chat").tap();
  await expect(transcript.getByText("Thought it through.")).toBeVisible();
  await expect(transcript.getByText(/^tool answered: /u)).toBeVisible();
  await expect(idle).toBeVisible();

  // Rewind on this runtime is PI's own branch move: the tool turn leaves the transcript and returns to the composer.
  await expect(rewind).toHaveCount(2);
  await rewind.nth(1).tap();
  await expect(screen.getByText("Message restored to the composer. The previous branch is kept.")).toBeVisible();
  await expect(message).toHaveValue(/^E2E_CALL:/u);
  await expect(transcript.getByText(/^tool answered: /u)).toBeHidden();
  await expect(transcript.getByText("Thought it through.")).toBeVisible();
  await expect(idle).toBeVisible();
});
