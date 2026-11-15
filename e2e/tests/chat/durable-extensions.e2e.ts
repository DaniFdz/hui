/** A Durable session loads the PI extensions its configuration names: their tools run in turns and show as tool rows, their commands sit under Plugin actions, their notices arrive as toasts, their dialogs as questions, and the turn survives a reload (CHAT-063). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

const echo = `E2E_CALL:${Buffer.from(JSON.stringify({ name: "fixture_echo", input: { text: "from the model" } })).toString("base64url")}`;

test("a Durable session runs its PI extensions' tools, commands, notices and dialogs, and keeps the turn after a reload", { tags: ["CHAT-063"] }, async ({ screen, hui }) => {
  const transcript = screen.getByTestId("transcript");
  const message = screen.getByLabel("Message");
  const menu = screen.getByLabel("Commands and paths");
  const card = screen.getByTestId("question-card");
  const idle = screen.getByLabel("Session status: Idle");

  const session = await hui.createSession({ title: "Durable extensions" });
  await hui.open(`/sessions/${session.id}`);
  await expect(idle).toBeVisible();
  // The header names the runtime the session runs on.
  await expect.poll(() => hui.textOf(screen.getByTestId("chat-header"))).toContain("durable");

  // The extension's own tool runs in the turn and draws as a tool row.
  await message.fill(echo);
  await screen.getByRole("button", "Send message").tap();
  await expect(transcript.getByText("tool answered: Extension tool executed: from the model")).toBeVisible();
  await expect(idle).toBeVisible();
  await hui.scrollTo(transcript, transcript.getByText("Used 1 tool"));
  await transcript.getByText("Used 1 tool").tap();
  await expect(transcript.getByRole("button", /^Used fixture echo/u)).toBeVisible();

  // Its commands are the menu's Plugin actions.
  await message.fill("/");
  await expect(menu.getByText("Plugin actions", { exact: true })).toBeVisible();
  await expect(menu.getByText("$check-status", { exact: true })).toBeVisible();
  await expect(menu.getByText("$hui-e2e-question", { exact: true })).toBeVisible();
  await message.fill("/check-status ready");
  await screen.getByRole("button", "Send message").tap();
  await expect(screen.getByText("Extension executed: ready")).toBeVisible();
  await expect(idle).toBeVisible();

  // Its dialog is a question card above the composer.
  await message.fill("/hui-e2e-question select");
  await screen.getByRole("button", "Send message").tap();
  await expect(card).toBeVisible();
  await expect(card.getByText("HUI E2E choice", { exact: true })).toBeVisible();
  await card.getByRole("button", "Skip").tap();
  await expect(card).toBeHidden();
  await expect(idle).toBeVisible();

  // What the extension's tool produced is still there after a reload.
  await hui.reload();
  await expect(transcript.getByText("tool answered: Extension tool executed: from the model")).toBeVisible();
  await hui.scrollTo(transcript, transcript.getByText("Used 1 tool"));
  await transcript.getByText("Used 1 tool").tap();
  await expect(transcript.getByRole("button", /^Used fixture echo/u)).toBeVisible();
});
