/** /btw and /side ask the utility model a side question in the Work pane's Side chat view, which never enters the conversation, and refuse a bare command or attachments (CHAT-043). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";
import { expectWorkPaneHidden, hideWork, reopenWork } from "../work/work-views.ts";

test("/btw answers in the Side chat Work view, which stays out of the transcript and closes with its tab", { tags: ["CHAT-043"], platforms: ["web"] }, async ({ screen, hui }) => {
  const message = screen.getByLabel("Message");
  const transcript = screen.getByTestId("transcript");
  const pane = screen.getByLabel("Work pane");
  const settings = await hui.api<{ models: Record<string, string> }>("GET", "/__hui/settings");
  await hui.api("PUT", "/__hui/settings", { ...settings, models: { ...settings.models, utility: "hui-e2e/fixture" } });
  const session = await hui.createSession({ title: "Side question" });
  await hui.open(`/sessions/${session.id}`);
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();

  const asked = await hui.intercept("POST", /\/btw$/u);
  await message.fill("/btw which file are we editing?");
  await screen.getByRole("button", "Send message").tap();
  await asked.arrived();
  await expect(pane.getByRole("tab", "Side chat")).toHaveAttribute("aria-selected", "true");
  await expect(screen.getByText("Asking utility model…")).toBeVisible();
  await expect(screen.getByText("which file are we editing?")).toBeVisible();
  await expect(screen.getByText("This exchange is not added to the main transcript.")).toBeVisible();
  await expect(message).toHaveValue("");
  await asked.deliver();
  await expect(screen.getByText("Fixture response.")).toBeVisible();
  await expect(screen.getByText("Ephemeral · hui-e2e/fixture")).toBeVisible();
  await expect(screen.getByText("Asking utility model…")).toBeHidden();
  // A phone draws the Side chat as the whole screen, so the transcript it must stay out of is read once that destination
  // is left; a desktop keeps both on screen and `hideWork` has nothing to do.
  await hideWork(screen);
  await expect(transcript.getByText("Start a conversation")).toBeVisible();
  await expect(transcript.getByText("which file are we editing?")).toBeHidden();

  await reopenWork(screen, "Side chat");
  await pane.getByRole("button", "Close Side chat").tap();
  await expect(pane.getByRole("tab", "Side chat")).toHaveCount(0);
  await expectWorkPaneHidden(screen);
  await hui.reload();
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();
  await expect(transcript.getByText("Start a conversation")).toBeVisible();
  await expectWorkPaneHidden(screen);

  await message.fill("/side and the other one?");
  await screen.getByRole("button", "Send message").tap();
  await expect(pane.getByRole("tab", "Side chat")).toHaveAttribute("aria-selected", "true");
  await expect(screen.getByText("and the other one?")).toBeVisible();
  await expect(screen.getByText("Fixture response.")).toBeVisible();
  await expect(transcript.getByText("and the other one?")).toBeHidden();
});

test("a bare /btw explains its form, attachments are refused and a failure shows in the view", { tags: ["CHAT-043"], platforms: ["web"] }, async ({ screen, hui }) => {
  const message = screen.getByLabel("Message");
  const pane = screen.getByLabel("Work pane");
  const session = await hui.createSession({ title: "Side refused" });
  await hui.open(`/sessions/${session.id}`);
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();

  await message.fill("/btw");
  await screen.getByRole("button", "Send message").tap();
  await expect(screen.getByText("Add a question after /btw. Example: /btw which file are we editing?")).toBeVisible();
  await expect(pane.getByRole("tab", "Side chat")).toHaveCount(0);

  await message.fill("/btw what is in this file?");
  await screen.getByLabel("Add attachment").first().tap();
  await hui.attach(screen.getByLabel("Choose files"), ["notes.txt"]);
  await expect(screen.getByLabel("Attached files").getByText("notes.txt")).toBeVisible();
  await screen.getByRole("button", "Send message").tap();
  await expect(screen.getByText("/btw does not support attachments in this build.")).toBeVisible();
  await expect(pane.getByRole("tab", "Side chat")).toHaveCount(0);
  await screen.getByLabel("Remove notes.txt").tap();

  const asked = await hui.intercept("POST", /\/btw$/u);
  await message.fill("/btw will this fail?");
  await screen.getByRole("button", "Send message").tap();
  await asked.reject(500, "The utility model is unavailable.");
  await expect(pane.getByRole("tab", "Side chat")).toHaveAttribute("aria-selected", "true");
  await expect(screen.getByText("The utility model is unavailable.")).toBeVisible();
  await expect(screen.getByText("will this fail?")).toBeVisible();
});
