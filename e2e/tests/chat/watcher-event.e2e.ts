/** A settled watcher's event reads as a system note where it woke the agent, never as the operator's message (AGENT-062). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("a settled watcher's event is a system note, not the operator's message", { tags: ["AGENT-062"], platforms: ["web"] }, async ({ screen, hui }) => {
  const session = await hui.createSession({ title: "Watcher event" });
  await hui.open(`/sessions/${session.id}`);
  const message = screen.getByLabel("Message");
  await expect(message).toBeVisible();
  await message.fill("E2E_WATCHER");
  await screen.getByRole("button", "Send message").tap();

  const note = screen.getByLabel("Watcher finished: Post /merge when approved");
  await expect(note).toBeVisible();
  await expect(note.getByText("Then: post /merge")).toBeVisible();
  await expect(note.getByText("The command finished and recorded status 0.")).toBeVisible();
  await expect(note.getByText("github.com/ddoghq/web-ui/pull/21532")).toBeVisible();
  await expect(screen.getByTestId("transcript").getByText("[HUI watcher event]", { exact: false })).toBeHidden();
});
