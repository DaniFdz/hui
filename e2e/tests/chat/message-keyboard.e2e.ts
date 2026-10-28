/** A message reached from the keyboard opens its copy menu and names its footer actions, and Escape dismisses a tooltip without stopping the run (CHAT-031). */
import { expect, type Locator } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";

const shown = async (hui: Hui, transcript: Locator, label: string) => hui.opacity(transcript.getByText(label, { exact: true }).first());

test("a focused message opens its copy menu from the keyboard, its footer actions name themselves on keyboard focus, and Escape dismisses a tooltip without stopping the run", { tags: ["CHAT-031"], platforms: ["web"] }, async ({ screen, hui }) => {
  const transcript = screen.getByTestId("transcript");
  const message = screen.getByLabel("Message");
  const send = screen.getByRole("button", "Send message");
  const reply = transcript.getByRole("button", "Reply to message").first();
  const menu = screen.getByText("Copy as markdown");
  await hui.clipboard();
  const session = await hui.createSession({ title: "Keyboard message actions" });
  await hui.open(`/sessions/${session.id}`);
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();
  await message.fill("Keyboard actions prompt");
  await send.tap();
  await expect(transcript.getByText("Fixture response.")).toBeVisible();
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();

  const focusMessage = async () => {
    await reply.focus();
    await hui.keyboard.down("Shift");
    await hui.keyboard.down("Tab");
    await hui.keyboard.up("Tab");
    await hui.keyboard.up("Shift");
    expect(await hui.focused()).toContain("Keyboard actions prompt");
  };

  await focusMessage();
  await hui.keyboard.down("ContextMenu");
  await hui.keyboard.up("ContextMenu");
  await expect(menu).toBeVisible();
  await menu.tap();
  await expect.poll(() => hui.copied()).toBe("Keyboard actions prompt");
  await expect(menu).toBeHidden();

  await focusMessage();
  await hui.keyboard.down("Shift");
  await hui.keyboard.down("F10");
  await hui.keyboard.up("F10");
  await hui.keyboard.up("Shift");
  await expect(menu).toBeVisible();
  await hui.keyboard.down("Escape");
  await hui.keyboard.up("Escape");
  await expect(menu).toBeHidden();
  await expect(transcript.getByText("Fixture response.")).toBeVisible();

  for (const [control, label] of [["Reply to message", "Reply"], ["Copy prompt", "Copy"], ["Rewind to here", "Rewind"], ["Fork into a new session from here", "Fork from here"]] as const) {
    await transcript.getByRole("button", control).first().focus();
    await expect.poll(async () => shown(hui, transcript, label)).toBe(1);
  }
  await hui.keyboard.down("Escape");
  await hui.keyboard.up("Escape");
  await expect.poll(async () => shown(hui, transcript, "Fork from here")).toBe(0);
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();

  await message.fill("E2E_REPLAY");
  await send.tap();
  await hui.provider.held();
  await expect(screen.getByLabel("Session status: Running")).toBeVisible();
  await reply.focus();
  await expect.poll(async () => shown(hui, transcript, "Reply")).toBe(1);
  await hui.keyboard.down("Escape");
  await hui.keyboard.up("Escape");
  await expect.poll(async () => shown(hui, transcript, "Reply")).toBe(0);
  await expect(screen.getByLabel("Session status: Running")).toBeVisible();
  await hui.provider.release();
  await expect(transcript.getByText("Replay prefix — replay suffix")).toBeVisible();
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();
});
