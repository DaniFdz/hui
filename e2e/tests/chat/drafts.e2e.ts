/** Each session keeps its own unsent draft, text and attachments, across switching chats and a reload, and the sidebar marks it (CHAT-011). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("a session's draft and attachment stay with it across switching and a reload, and sending clears only that draft", { tags: ["CHAT-011"], platforms: ["web"] }, async ({ screen, hui }) => {
  const message = screen.getByLabel("Message", { visible: true });
  const attached = screen.getByRole("button", "Remove notes.txt", { visible: true });
  const row = (title: string, draft: boolean) => screen.getByLabel(new RegExp(`^${title}, status idle, .*stage investigation${draft ? ", draft" : ""}$`, "u"));

  const one = await hui.createSession({ title: "Draft one" });
  await hui.createSession({ title: "Draft two" });
  await hui.open(`/sessions/${one.id}`);
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();
  await message.fill("Draft for one");
  await hui.attach(screen.getByLabel("Choose files"), ["notes.txt"]);
  await expect(attached).toBeVisible();
  await expect(row("Draft one", true)).toBeVisible();

  await row("Draft two", false).tap();
  await expect(message).toHaveValue("");
  await expect(attached).toBeHidden();
  await message.fill("Draft for two");
  await expect(row("Draft two", true)).toBeVisible();

  await hui.reload();
  await expect(message).toHaveValue("Draft for two");
  await expect(row("Draft one", true)).toBeVisible();
  await row("Draft one", true).tap();
  await expect(message).toHaveValue("Draft for one");
  await expect(attached).toBeVisible();

  await screen.getByRole("button", "Send message", { visible: true }).tap();
  await expect(screen.getByTestId("transcript", { visible: true }).getByText("Fixture response.")).toBeVisible();
  await expect(message).toHaveValue("");
  await expect(row("Draft one", false)).toBeVisible();
  await expect(row("Draft two", true)).toBeVisible();
  await expect(attached).toBeHidden();
});
