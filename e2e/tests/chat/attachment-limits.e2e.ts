/** Attachments over the count, size or total limits, or with unsafe names, are refused with a toast and never sent, while names with spaces and Unicode are fine (CHAT-014). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

const MB = 1024 * 1024;
const UNSAFE_NAME = "Attachment names must be 1–128 characters without path separators or controls.";

test("attachments over the limits or with unsafe names are refused with a toast and never sent", { tags: ["CHAT-014"], platforms: ["web"] }, async ({ screen, hui }) => {
  const files = screen.getByLabel("Choose files");
  const attached = screen.getByLabel("Attached files");
  const transcript = screen.getByTestId("transcript");
  const refused = async (message: string) => {
    await expect(screen.getByText(message)).toBeVisible();
    await screen.getByRole("button", "Dismiss notification").tap();
    await expect(screen.getByText(message)).toBeHidden();
  };

  const session = await hui.createSession({ title: "Attachment limits" });
  await hui.open(`/sessions/${session.id}`);
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();

  const parts = Array.from({ length: 8 }, (_, index) => `part ${index + 1}.txt`);
  await hui.attach(files, parts.map((name) => ({ name, bytes: 16 })));
  await expect(attached.getByRole("button", "Remove part 8.txt")).toBeVisible();
  await hui.attach(files, [{ name: "part 9.txt", bytes: 16 }]);
  await refused("At most 8 attachments may be sent at once.");
  await expect(attached.getByRole("button", "Remove part 9.txt")).toBeHidden();
  for (const name of parts) await attached.getByRole("button", `Remove ${name}`).tap();
  await expect(attached.getByRole("button", "Remove part 8.txt")).toBeHidden();

  await hui.attach(files, [{ name: "huge.bin", bytes: 12 * MB + 1 }]);
  await refused("huge.bin is larger than 12 MB.");
  await hui.attach(files, [{ name: "first half.bin", bytes: 9 * MB }, { name: "second half.bin", bytes: 9 * MB }]);
  await refused("Attachments must be 16 MB or less in total.");
  await hui.attach(files, [{ name: "back\\slash.txt", bytes: 16 }]);
  await refused(UNSAFE_NAME);
  await hui.attach(files, [{ name: "bell\u0007.txt", bytes: 16 }]);
  await refused(UNSAFE_NAME);

  await hui.attach(files, [{ name: "notes ✓ 日本.txt", bytes: 16 }]);
  await expect(attached.getByRole("button", "Remove notes ✓ 日本.txt")).toBeVisible();
  await expect(attached.getByRole("button", "Remove huge.bin")).toBeHidden();
  await expect(attached.getByRole("button", "Remove first half.bin")).toBeHidden();
  await expect(transcript.getByText("Fixture response.")).toBeHidden();
  await screen.getByLabel("Message").fill("Read the notes");
  await screen.getByRole("button", "Send message").tap();
  await expect(transcript.getByText("Fixture response.")).toBeVisible();
  await expect(transcript.getByText("notes ✓ 日本.txt")).toBeVisible();
  await expect(transcript.getByText("Read the notes")).toBeVisible();
  await expect(transcript.getByText(/part \d\.txt|huge\.bin|half\.bin|slash\.txt|bell/u)).toBeHidden();
});
