/** A settled watcher's event reads as a system note where it woke the agent, never as the operator's message (AGENT-062). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("a settled watcher's event is a system note that folds onto what it reported", { tags: ["AGENT-062"], platforms: ["web"] }, async ({ screen, hui }) => {
  const session = await hui.createSession({ title: "Watcher event" });
  await hui.open(`/sessions/${session.id}`);
  const message = screen.getByLabel("Message");
  await expect(message).toBeVisible();
  await message.fill("E2E_WATCHER");
  await screen.getByRole("button", "Send message").tap();

  // The row says which wait is over and how it ended; nothing from the event's own instructions is drawn.
  const note = screen.getByLabel("Watcher finished: Post /merge when approved");
  await expect(note).toBeVisible();
  await expect(note.getByText(/^Done · /u)).toBeVisible();
  await expect(note.getByText("Then: post /merge")).toBeHidden();
  await expect(screen.getByTestId("transcript").getByText("[HUI watcher event]", { exact: false })).toBeHidden();

  // Opening it shows what it reported: the outcome, the command's last line, the exit status, its times and the log.
  await note.getByText("Watcher finished: Post /merge when approved").tap();
  await expect(note.getByText("Then: post /merge")).toBeVisible();
  await expect(note.getByText("posted /merge")).toBeVisible();
  await expect(note.getByText("Exit 0")).toBeVisible();
  await expect(note.getByText(/^Started .+ · ended /u)).toBeVisible();
  await expect(note.getByText("/watchers/", { exact: false })).toBeVisible();
  await expect(note.getByText("The command finished and recorded status 0.")).toBeVisible();
  await expect(note.getByText("github.com/ddoghq/web-ui/pull/21532")).toBeVisible();
});
