/** Appearance's Chat preferences change the conversation: Message width narrows or widens it and the composer in every open session, Collapse task progress starts a progress card collapsed, and Send shortcut decides what Enter does (SET-012, SET-013, SET-014). */
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

  await hui.open(`/sessions/${first.id}`);
  await hui.sessionMenu("Second width");
  await screen.getByText("Open in split pane", { visible: true }).tap();
  await screen.getByRole("button", "Pane actions").tap();
  await screen.getByText("Split down", { visible: true }).tap();
  await expect(titles).toHaveCount(3);
  await titles.filter({ hasText: "First width" }).tap();
  await screen.getByRole("button", "Close session pane").tap();
  await expect(titles).toHaveCount(2);
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

test("Collapse task progress starts an agent's progress card collapsed but expandable, and off it starts expanded", { tags: ["SET-013"], platforms: ["web"] }, async ({ screen, hui }) => {
  const collapse = screen.getByRole("switch", "Collapse task progress");
  const card = screen.getByTestId("task-progress");
  const steps = card.getByLabel("Task progress");
  const progress = async (title: string) => {
    const session = await hui.createSession({ title });
    await hui.prompt(session, "E2E_PROGRESS");
    await hui.open(`/sessions/${session.id}`);
    await expect(card).toBeVisible();
  };

  await hui.open("/settings/appearance");
  await hui.flip(collapse);
  await expect(collapse).toBeChecked();
  await progress("Collapsed progress");
  await expect(card.getByText("1/2", { visible: true })).toBeVisible();
  await expect(steps).toBeHidden();
  await card.getByText("Verify presentation", { visible: true }).tap();
  await expect(steps.getByText("Read fixture")).toBeVisible();
  await expect(card.getByText("1 of 2", { visible: true })).toBeVisible();

  await hui.open("/settings/appearance");
  await hui.flip(collapse);
  await expect(collapse).toBeChecked({ checked: false });
  await progress("Expanded progress");
  await expect(steps.getByText("Read fixture")).toBeVisible();
  await expect(card.getByText("1 of 2", { visible: true })).toBeVisible();
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
