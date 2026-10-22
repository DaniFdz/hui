/** /btw and /side ask the utility model a side question in an ephemeral Side chat rail that never enters the conversation, and refuse a bare command or attachments (CHAT-043). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

test("/btw answers in a Side chat rail that stays out of the transcript and closes", { tags: ["CHAT-043"], platforms: ["web"] }, async ({ screen, hui }) => {
  const message = screen.getByLabel("Message");
  const transcript = screen.getByTestId("transcript");
  const rail = screen.getByLabel("Side chat");
  const settings = await hui.api<{ models: Record<string, string> }>("GET", "/__hui/settings");
  await hui.api("PUT", "/__hui/settings", { ...settings, models: { ...settings.models, utility: "hui-e2e/fixture" } });
  const session = await hui.createSession({ title: "Side question" });
  await hui.open(`/sessions/${session.id}`);
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();

  const asked = await hui.intercept("POST", /\/btw$/u);
  await message.fill("/btw which file are we editing?");
  await screen.getByRole("button", "Send message").tap();
  await asked.arrived();
  await expect(rail.getByText("Asking utility model…")).toBeVisible();
  await expect(rail.getByText("which file are we editing?")).toBeVisible();
  await expect(rail.getByText("This exchange is not added to the main transcript.")).toBeVisible();
  await expect(message).toHaveValue("");
  await asked.deliver();
  await expect(rail.getByText("Fixture response.")).toBeVisible();
  await expect(rail.getByText("Ephemeral · hui-e2e/fixture")).toBeVisible();
  await expect(rail.getByText("Asking utility model…")).toBeHidden();
  await expect(transcript.getByText("Start a conversation")).toBeVisible();
  await expect(transcript.getByText("which file are we editing?")).toBeHidden();

  await screen.getByRole("button", "Close side chat").tap();
  await expect(rail).toBeHidden();
  await hui.reload();
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();
  await expect(transcript.getByText("Start a conversation")).toBeVisible();

  await message.fill("/side and the other one?");
  await screen.getByRole("button", "Send message").tap();
  await expect(rail.getByText("and the other one?")).toBeVisible();
  await expect(rail.getByText("Fixture response.")).toBeVisible();
  await expect(transcript.getByText("and the other one?")).toBeHidden();
});

test("a bare /btw explains its form, attachments are refused and a failure shows in the rail", { tags: ["CHAT-043"], platforms: ["web"] }, async ({ screen, hui }) => {
  const message = screen.getByLabel("Message");
  const rail = screen.getByLabel("Side chat");
  const session = await hui.createSession({ title: "Side refused" });
  await hui.open(`/sessions/${session.id}`);
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();

  await message.fill("/btw");
  await screen.getByRole("button", "Send message").tap();
  await expect(screen.getByText("Add a question after /btw. Example: /btw which file are we editing?")).toBeVisible();

  await message.fill("/btw what is in this file?");
  await screen.getByLabel("Add attachment").first().tap();
  await hui.attach(screen.getByLabel("Choose files"), ["notes.txt"]);
  await expect(screen.getByLabel("Attached files").getByText("notes.txt")).toBeVisible();
  await screen.getByRole("button", "Send message").tap();
  await expect(screen.getByText("/btw does not support attachments in this build.")).toBeVisible();
  await expect(rail).toBeHidden();
  await screen.getByLabel("Remove notes.txt").tap();

  const asked = await hui.intercept("POST", /\/btw$/u);
  await message.fill("/btw will this fail?");
  await screen.getByRole("button", "Send message").tap();
  await asked.reject(500, "The utility model is unavailable.");
  await expect(rail.getByText("The utility model is unavailable.")).toBeVisible();
  await expect(rail.getByText("will this fail?")).toBeVisible();
});
