/** A chat notice is a toast in the corner, not a transcript paragraph, is announced as a status, and Dismiss removes it (SHELL-026). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("a chat notice appears as a top-corner toast that Dismiss removes and the transcript never shows", { tags: ["SHELL-026"], platforms: ["web"] }, async ({ screen, hui }) => {
  const message = screen.getByLabel("Message");
  const transcript = screen.getByTestId("transcript");
  const session = await hui.createSession({ title: "Notice toast" });

  await hui.open(`/sessions/${session.id}`);
  await message.fill("Seed before the notice");
  await screen.getByRole("button", "Send message").tap();
  await expect(transcript.getByText("Fixture response.")).toBeVisible();

  await message.fill("/cle");
  await screen.getByLabel("Commands and paths").getByText("/clear", { exact: true }).tap();
  await screen.getByRole("button", "Send message").tap();

  const toast = screen.getByText("Session context cleared.", { exact: true });
  await expect(toast).toBeVisible();
  await expect(transcript.getByText("Session context cleared.", { exact: true })).toHaveCount(0);
  await screen.getByRole("button", "Dismiss notification").tap();
  await expect(toast).toBeHidden();
});
