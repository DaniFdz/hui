/** Fork into a new session from here copies a finished reply into a new session, from a new worktree or the same
 * checkout, and a refusal stays in the dialog that asked (CHAT-035). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";
import { expectChatTitle } from "../sess/chat-header.ts";

test("Fork from here offers a new worktree or the same checkout, keeps a refusal in the dialog, copies the reply with the source's model and reasoning, and works in the same folder outside Git", { tags: ["CHAT-035"], platforms: ["web"] }, async ({ screen, hui }) => {
  const repository = await hui.repository();
  const source = await hui.createSession({ title: "Fork the reply", cwd: repository.path });
  await hui.open(`/sessions/${source.id}`);
  // A session swap leaves the pane it came from on screen for a moment: the open conversation is the visible one.
  const transcript = screen.getByTestId("transcript", { visible: true });
  const header = screen.getByTestId("chat-header", { visible: true });
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();
  // The group the fork has to join is the one the source's own header names.
  const sourceGroup = (await hui.textOf(header)).split("·")[1]?.trim();

  // The fork inherits the model and the reasoning level the session runs on.
  await screen.getByLabel("Model: HUI SDK Fixture").tap();
  await screen.getByRole("listbox", "Model").getByRole("option", { name: /Opus fixture/u }).tap();
  await screen.getByLabel("Thinking: high").tap();
  await screen.getByLabel("Thinking effort").fill("4");
  await expect(screen.getByLabel("Thinking: max")).toBeVisible();
  await screen.getByLabel("Thinking: max").tap();
  await screen.getByLabel("Message").fill("Keep this turn");
  await screen.getByRole("button", "Send message").tap();
  await expect(transcript.getByText("Fixture response.")).toBeVisible();
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();

  const dialog = screen.getByRole("dialog", { name: "Fork from here" });
  const choice = (name: string) => dialog.getByRole("radio", { name: new RegExp(`^${name} `, "u") });
  const fork = dialog.getByRole("button", { name: /^Fork$/u });
  const openFork = async () => {
    await hui.messageActions(transcript.getByText("Fixture response."));
    await screen.getByLabel("Fork into a new session from here", { visible: true }).tap();
    // The choice arrives once the checkout is inspected.
    await expect(choice("New worktree")).toBeVisible();
  };

  // A fork the gateway refuses says why and stays where it was asked.
  const refused = await hui.intercept("POST", /\/__hui\/sessions\/[^/]+\/fork$/u);
  await openFork();
  await fork.tap();
  await refused.reject(500, "The fixture refused this fork.");
  await expect.poll(() => hui.textOf(dialog)).toContain("The fixture refused this fork.");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", "Cancel").tap();
  await expect(dialog).toBeHidden();

  // A Git checkout offers a new worktree on a new branch, and the same checkout for a fork that shares the files.
  await openFork();
  await expect(choice("New worktree")).toBeChecked();
  const suffix = dialog.getByRole("textbox", { name: /^Branch suffix/u });
  await expect(suffix).toBeVisible();
  await expect.poll(() => suffix.getAttribute("placeholder")).toMatch(/-fork$/u);
  await choice("Same checkout").tap();
  await expect(dialog.getByText("Both sessions edit the same files.")).toBeVisible();
  await expect(suffix).toBeHidden();
  await choice("New worktree").tap();
  await fork.tap();
  await expect(dialog).toBeHidden();

  // The open conversation is the fork, in the source's group: the header's heading names it on the wide layout and its
  // Active panel chooser names it on a phone, where the chooser takes the title's place.
  await expectChatTitle(screen, "Fork the reply (fork)");
  await expect.poll(async () => (await hui.textOf(screen.getByTestId("chat-header", { visible: true }))).split("·")[1]?.trim()).toBe(sourceGroup);
  await expect(screen.getByLabel("Model: Opus fixture", { visible: true })).toBeVisible();
  await expect(screen.getByLabel("Thinking: max", { visible: true })).toBeVisible();
  await expect(screen.getByTestId("transcript", { visible: true }).getByText("Keep this turn")).toBeVisible();
  await expect(screen.getByTestId("transcript", { visible: true }).getByText("Fixture response.")).toBeVisible();

  // The source is untouched: its own history, model and level are what they were.
  await hui.open(`/sessions/${source.id}`);
  await expectChatTitle(screen, "Fork the reply");
  await expect(screen.getByLabel("Model: Opus fixture", { visible: true })).toBeVisible();
  await expect(screen.getByLabel("Thinking: max", { visible: true })).toBeVisible();
  await expect(transcript.getByText("Keep this turn")).toBeVisible();
  await expect(transcript.getByText("Fixture response.")).toHaveCount(1);

  // A folder outside Git has one place to fork into, and the dialog says so instead of offering a worktree.
  const plain = await hui.createSession({ title: "Fork outside Git" });
  await hui.prompt(plain, "Keep this too");
  await hui.open(`/sessions/${plain.id}`);
  await expect(screen.getByTestId("transcript", { visible: true }).getByText("Fixture response.")).toBeVisible();
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();
  await hui.messageActions(screen.getByTestId("transcript", { visible: true }).getByText("Fixture response."));
  await screen.getByLabel("Fork into a new session from here", { visible: true }).tap();
  await expect(dialog.getByText("Not a Git repository; the fork works in the same folder.")).toBeVisible();
  await expect(choice("New worktree")).toHaveCount(0);
  await dialog.getByRole("button", "Cancel").tap();
  await expect(dialog).toBeHidden();
});
