/** A prompt that is one file and no text: the composer sends it, the turn shows the file's card and no text bubble, the
 * reply names the file's path, and an empty composer with nothing attached still refuses (CHAT-098). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("a file alone is a prompt", { tags: ["CHAT-098"], platforms: ["web"] }, async ({ screen, hui }) => {
  const message = screen.getByLabel("Message");
  const send = screen.getByRole("button", "Send message");
  const status = (value: string) => screen.getByLabel(`Session status: ${value}`);
  const composerAttachments = screen.getByLabel("Attached files");
  const transcript = screen.getByTestId("transcript");

  const session = await hui.createSession({ title: "A file alone" });
  // The fixture answers only a file whose name carries this marker, so every other request keeps the reply it has today.
  const file = { name: `file-only-${session.id}.txt`, text: "A line the agent may open and read.\n" };
  await hui.open(`/sessions/${session.id}`);
  await expect(status("Idle")).toBeVisible();

  await screen.getByLabel("Add attachment").first().tap();
  await expect(screen.getByText("File", { exact: true })).toBeVisible();
  await hui.attach(screen.getByLabel("Choose files"), [file]);
  await expect(composerAttachments.getByRole("button", `Remove ${file.name}`)).toBeVisible();

  // No words at all: the attachment is the whole prompt, so Send message opens for it.
  await expect(message).toHaveValue("");
  await expect(send).toBeEnabled();
  await send.tap();

  const card = transcript.getByRole("listitem").filter({ hasText: file.name });
  await expect(card).toBeVisible();
  // The reply names the file too, so the operator's row is the one carrying the attachments list beside its words.
  const row = transcript.getByTestId("message-row").filter({ has: screen.getByRole("list", "Attachments") });
  // An empty text block is not painted: the sent turn is the file's card, with no bubble of the operator's own.
  await expect(row.getByTestId("message-text")).toBeHidden();
  await expect(transcript.getByText(/File received: .*file-only-.*\.txt/u)).toBeVisible();
  await expect(status("Idle")).toBeVisible();

  // Nothing typed and nothing attached is still not a prompt.
  await expect(message).toHaveValue("");
  await expect(composerAttachments.getByRole("button", `Remove ${file.name}`)).toBeHidden();
  await expect(send).toBeDisabled();
});
