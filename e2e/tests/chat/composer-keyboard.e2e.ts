/** The composer and the queue from the keyboard: Enter sends or steers, Shift+Enter breaks a line, Command or Ctrl+Enter queues, and the queue's handles and editor take arrows, Enter and Escape (CHAT-002, CHAT-009). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("Enter sends and steers, Shift+Enter breaks a line, Command or Ctrl+Enter queues, and the modifier-Enter preference makes Enter a line break", { tags: ["CHAT-002"], platforms: ["web"] }, async ({ screen, hui }) => {
  const message = screen.getByLabel("Message");
  const queue = screen.getByLabel("Queued messages");
  const transcript = screen.getByTestId("transcript");
  const idle = screen.getByLabel("Session status: Idle");

  const session = await hui.createSession({ title: "Keyboard sending" });
  await hui.open(`/sessions/${session.id}`);
  await expect(idle).toBeVisible();
  await message.fill("First line");
  await message.press("Shift+Enter");
  await message.pressSequentially("second line");
  await expect(message).toHaveValue("First line\nsecond line");
  await message.press("Enter");
  await expect(transcript.getByText(/^First line\s+second line$/u)).toBeVisible();
  await expect(transcript.getByText("Fixture response.")).toBeVisible();
  await expect(message).toHaveValue("");

  await message.fill("E2E_REPLAY");
  await message.press("Enter");
  await hui.provider.held();
  await expect(screen.getByPlaceholder(/^↵ adds to this run · (?:⌘|Ctrl\+)↵ queues for later$/u)).toBeVisible();
  await message.fill("Steered with Enter");
  await message.press("Enter");
  await expect(queue).toHaveText(/^\s*Steered with Enter\s*Steer\s*$/u);
  await message.fill("Queued with the modifier");
  await message.press("ControlOrMeta+Enter");
  await expect(queue).toHaveText(/^\s*Steered with Enter\s*Steer\s*Queued with the modifier\s*Follow up/u);
  await hui.provider.release();
  await expect(transcript).toHaveText(/Steered with Enter.*Fixture response\..*Queued with the modifier.*Fixture response\./su);
  await expect(transcript.getByText("Fixture response.")).toHaveCount(3);
  await expect(idle).toBeVisible();

  const settings = await hui.api<{ chat: Record<string, unknown> }>("GET", "/__hui/settings");
  await hui.api("PUT", "/__hui/settings", { ...settings, chat: { ...settings.chat, sendShortcut: "modifierEnter" } });
  await hui.reload();
  await message.fill("Line one");
  await message.press("Enter");
  await message.pressSequentially("line two");
  await expect(message).toHaveValue("Line one\nline two");
  await message.press("ControlOrMeta+Enter");
  await expect(transcript.getByText(/^Line one\s+line two$/u)).toBeVisible();
  await expect(transcript.getByText("Fixture response.")).toHaveCount(4);
});

test("Arrow keys on a queued message's handle move it, and the inline editor saves with Enter and cancels with Escape", { tags: ["CHAT-009"], platforms: ["web"] }, async ({ screen, hui }) => {
  const message = screen.getByLabel("Message");
  const queue = screen.getByLabel("Queued messages");
  const handles = queue.getByRole("button", "Reorder queued message");
  const editor = queue.getByRole("textbox", "Edit queued message");

  const session = await hui.createSession({ title: "Keyboard queue" });
  await hui.open(`/sessions/${session.id}`);
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();
  await message.fill("E2E_REPLAY");
  await message.press("Enter");
  await hui.provider.held();
  for (const text of ["First follow-up", "Second follow-up"]) {
    await message.fill(text);
    await message.press("ControlOrMeta+Enter");
    await expect(queue.getByText(text)).toBeVisible();
  }

  await handles.first().press("ArrowDown");
  await expect(queue).toHaveText(/Second follow-up.*First follow-up/su);
  await handles.nth(1).press("ArrowUp");
  await expect(queue).toHaveText(/First follow-up.*Second follow-up/su);

  await queue.getByRole("button", "Edit queued message").first().tap();
  await editor.fill("Saved with Enter");
  await editor.press("Enter");
  await expect(queue.getByText("Saved with Enter")).toBeVisible();
  await expect(editor).toBeHidden();

  await queue.getByRole("button", "Edit queued message").nth(1).tap();
  await editor.fill("Discarded with Escape");
  await editor.press("Escape");
  await expect(queue.getByText("Second follow-up")).toBeVisible();
  await expect(editor).toBeHidden();
  await expect(queue.getByText("Discarded with Escape")).toBeHidden();
});
