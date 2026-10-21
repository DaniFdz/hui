/** Attaching an image and a file, sending them, and opening both from the sent turn after a reload (CHAT-013). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("attached images and files are sent and open again from the transcript", { tags: ["CHAT-013"], platforms: ["web"] }, async ({ screen, hui }) => {
  const message = screen.getByLabel("Message");
  const send = screen.getByRole("button", "Send message");
  const status = (value: string) => screen.getByLabel(`Session status: ${value}`);
  const composerAttachments = screen.getByLabel("Attached files");
  const transcript = screen.getByTestId("transcript");

  const session = await hui.createSession({ title: "Attach files" });
  await hui.open(`/sessions/${session.id}`);
  await expect(status("Idle")).toBeVisible();

  await screen.getByLabel("Add attachment").first().tap();
  await expect(screen.getByText("Take photo")).toBeVisible();
  await expect(screen.getByText("Photo", { exact: true })).toBeVisible();
  await expect(screen.getByText("File", { exact: true })).toBeVisible();
  await hui.attach(screen.getByLabel("Choose photos"), ["shot.png"]);
  await hui.attach(screen.getByLabel("Choose files"), ["notes.txt"]);
  await expect(composerAttachments.getByRole("button", "Remove shot.png")).toBeVisible();
  await expect(composerAttachments.getByText("notes.txt")).toBeVisible();
  await composerAttachments.getByRole("button", "Remove shot.png").tap();
  await expect(composerAttachments.getByRole("button", "Remove notes.txt")).toBeVisible();
  await expect(composerAttachments.getByRole("button", "Remove shot.png")).toBeHidden();
  await expect(send).toBeDisabled();

  await message.fill("Summarize the notes");
  await send.tap();
  await expect(transcript.getByRole("listitem").filter({ hasText: "notes.txt" })).toBeVisible();
  await expect(transcript.getByText("Fixture response.")).toBeVisible();
  await expect(status("Idle")).toBeVisible();

  await hui.attach(screen.getByLabel("Choose photos"), ["shot.png"]);
  await expect(composerAttachments.getByRole("button", "Remove shot.png")).toBeVisible();
  await send.tap();
  await expect(transcript.getByLabel("Open shot.png")).toBeVisible();
  await expect(status("Idle")).toBeVisible();

  await hui.reload();
  await expect(transcript.getByLabel("Open shot.png")).toBeVisible();
  await expect(transcript.getByText("notes.txt")).toBeVisible();
  await expect(transcript.getByText(/hui-attachments|\/attachments\//u)).toBeHidden();
  await transcript.getByLabel("Open shot.png").tap();
  await expect(screen.getByLabel("Image viewer: shot.png")).toBeVisible();
  await screen.getByRole("button", "Close viewer").tap();
  await expect(screen.getByLabel("Image viewer: shot.png")).toBeHidden();
  expect(await hui.download(transcript.getByLabel("Open notes.txt"))).toEqual({ name: "notes.txt", text: "Quarterly notes: revenue is up.\n" });
});
