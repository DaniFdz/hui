/** Appearance's Chat preferences change the conversation: Message width narrows or widens it and the composer in every open session, Send shortcut decides what Enter does (SET-012, SET-014). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("Message width narrows or widens the conversation and the composer in every open session", { tags: ["SET-012"], platforms: ["web"] }, async ({ screen, hui }) => {
  const first = await hui.createSession({ title: "First width" });
  const second = await hui.createSession({ title: "Second width" });
  await hui.prompt(first, "E2E_MARKDOWN_PARITY");
  await hui.prompt(second, "E2E_MARKDOWN_PARITY");
  const titles = screen.getByTestId("session-title", { visible: true });
  const replies = screen.getByTestId("transcript").getByText("Final paragraph.");
  const widths = async () => {
    await hui.open(`/sessions/${first.id}`);
    await expect(titles).toHaveText(["First width", "Second width"]);
    await expect(replies).toHaveCount(2);
    const targets = [...await replies.all(), ...await screen.getByLabel("Message", { visible: true }).all()];
    return Promise.all(targets.map(async (target) => (await target.boundingBox())!.width));
  };
  const choose = async (from: string, to: string) => {
    await hui.open("/settings/appearance");
    await screen.getByRole("button", `Message width: ${from}`).tap();
    await screen.getByLabel("Message width").getByText(to, { exact: true }).tap();
    await expect(screen.getByRole("button", `Message width: ${to}`)).toBeVisible();
  };

  // A width caps the conversation and the composer at 40rem, 48rem or 64rem, so each side-by-side pane stays wider
  // than Comfortable's 48rem for the setting, not the pane, to be what the measurement reads.
  await hui.wideScreen(2200);
  await hui.open(`/sessions/${first.id}`);
  await hui.sessionMenu("Second width");
  await screen.getByText("Open in split pane", { visible: true }).tap();
  await expect(titles).toHaveCount(2);
  // The split opens active, and a session route replaces the active pane's session: focusing the First width pane first
  // makes every later /sessions/<first> open land on the pane that already shows that session instead of replacing it.
  await titles.filter({ hasText: "First width" }).tap();
  await expect(screen.getByTestId("session-pane").first()).toHaveAttribute("aria-current", "true");
  const comfortable = await widths();
  await choose("Comfortable", "Compact");
  const compact = await widths();
  await choose("Compact", "Wide");
  const wide = await widths();
  expect(comfortable).toHaveLength(4);
  comfortable.forEach((width, index) => {
    expect(compact[index]).toBeLessThan(width);
    expect(wide[index]).toBeGreaterThan(width);
  });
});

test("Send shortcut set to Command or Ctrl + Enter makes Enter break the line, and set to Enter makes Enter send", { tags: ["SET-014"], platforms: ["web"] }, async ({ screen, hui }) => {
  const message = screen.getByLabel("Message");
  const transcript = screen.getByTestId("transcript");
  const replies = transcript.getByText("Fixture response.");
  const shortcut = async (from: string, to: string) => {
    await hui.open("/settings/appearance");
    await screen.getByRole("button", `Send shortcut: ${from}`).tap();
    await screen.getByLabel("Send shortcut").getByText(to, { exact: true }).tap();
    await expect(screen.getByRole("button", `Send shortcut: ${to}`)).toBeVisible();
    await hui.open(`/sessions/${session.id}`);
    await expect(screen.getByLabel("Session status: Idle")).toBeVisible();
  };
  const session = await hui.createSession({ title: "Shortcut" });

  await shortcut("Enter", "⌘/Ctrl + Enter");
  await message.fill("Line one");
  await message.press("Enter");
  await message.pressSequentially("line two");
  await expect(message).toHaveValue("Line one\nline two");
  await message.press("ControlOrMeta+Enter");
  await expect(transcript.getByText(/^Line one\s+line two$/u)).toBeVisible();
  await expect(replies).toHaveCount(1);
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();
  await message.fill("Sent with the button");
  await message.press("Enter");
  await expect(message).toHaveValue("Sent with the button\n");
  await screen.getByRole("button", "Send message").tap();
  await expect(transcript.getByText("Sent with the button")).toBeVisible();
  await expect(replies).toHaveCount(2);

  await shortcut("⌘/Ctrl + Enter", "Enter");
  await message.fill("Sent with Enter");
  await message.press("Enter");
  await expect(transcript.getByText("Sent with Enter")).toBeVisible();
  await expect(message).toHaveValue("");
  await expect(replies).toHaveCount(3);
});
