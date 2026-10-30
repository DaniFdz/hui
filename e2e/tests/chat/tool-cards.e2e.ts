/** Tool calls show as cards: a shell command, a read's copied output, any other tool, and a failed call's error (CHAT-026, CHAT-068, CHAT-028, CHAT-029). */
import { expect } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";

const call = (verb: "CALL" | "HOLD", name: string, input: Record<string, unknown>) =>
  `E2E_${verb}:${Buffer.from(JSON.stringify({ name, input })).toString("base64url")}`;

const openSession = async (hui: Hui, title: string) => {
  const session = await hui.createSession({ title });
  await hui.open(`/sessions/${session.id}`);
  return session;
};

test("a command shows a bounded preview and opens to its output, state and copy", { tags: ["CHAT-026"] }, async ({ screen, hui }) => {
  const message = screen.getByLabel("Message");
  const send = screen.getByRole("button", "Send message");
  const transcript = screen.getByTestId("transcript");
  const idle = screen.getByLabel("Session status: Idle");
  await hui.clipboard();
  const session = await openSession(hui, "Command cards");
  await expect(idle).toBeVisible();

  const words = Array.from({ length: 50 }, (_, index) => `word${index}`).join(" ");
  const command = `cd '${hui.workspace}' && echo ${words}`;
  await hui.prompt(session, call("CALL", "bash", { command }));
  await expect(transcript.getByText(/^tool answered: /u)).toBeVisible();
  await expect(idle).toBeVisible();
  await hui.scrollTo(transcript, transcript.getByText("Used 1 tool"));
  const row = transcript.getByRole("button", /^Ran echo word0/u);
  if (!(await row.isVisible())) await transcript.getByText("Used 1 tool").tap();
  await hui.scrollTo(transcript, row);
  await row.tap();
  await expect(transcript.getByText(command).first()).toBeVisible();
  const output = transcript.getByText(words).last();
  await expect(output).toBeVisible();
  await expect(transcript.getByText("Completed")).toBeVisible();
  await hui.contextMenu(output);
  await screen.getByText("Copy as markdown").tap();
  await expect.poll(() => hui.copied()).toBe(`${words}\n`);

  await message.fill("E2E_COMMAND_RUNNING");
  await send.tap();
  await hui.provider.held();
  await hui.scrollTo(transcript, transcript.getByText("Using 1 tool"));
  const live = transcript.getByRole("button", /^Running curl --silent/u);
  if (!(await live.isVisible())) await transcript.getByText("Using 1 tool").tap();
  await hui.scrollTo(transcript, live);
  await live.tap();
  await expect(transcript.getByText("Running", { exact: true })).toBeVisible();
  await hui.provider.release();
  await expect(idle).toBeVisible();
  await expect(transcript.getByText("Completed")).toHaveCount(2);

  await openSession(hui, "Failed command");
  await message.fill("E2E_COMMAND_FAILURE");
  await send.tap();
  await expect(transcript.getByText("Tool complete")).toBeVisible();
  await expect(idle).toBeVisible();
  await hui.scrollTo(transcript, transcript.getByText("Used 1 tool"));
  const failedCommand = transcript.getByRole("button", /^Ran false/u);
  if (!(await failedCommand.isVisible())) await transcript.getByText("Used 1 tool").tap();
  await hui.scrollTo(transcript, failedCommand);
  await failedCommand.tap();
  await expect(transcript.getByText("false", { exact: true }).first()).toBeVisible();
  await expect(transcript.getByText("failed", { exact: true })).toBeVisible();
});

test("a read's output copies from its context menu", { tags: ["CHAT-068"] }, async ({ screen, hui }) => {
  const transcript = screen.getByTestId("transcript");
  await hui.clipboard();
  await openSession(hui, "Read copy");
  await screen.getByLabel("Message").fill("E2E_RICH");
  await screen.getByRole("button", "Send message").tap();
  await expect(transcript.getByText("Tool complete")).toBeVisible();
  await hui.scrollTo(transcript, transcript.getByText("Used 1 tool"));
  const read = transcript.getByRole("button", /^Read fixture\.txt/u);
  if (!(await read.isVisible())) await transcript.getByText("Used 1 tool").tap();
  await hui.scrollTo(transcript, read);
  await read.tap();
  const content = transcript.getByText("Real SDK browser fixture", { exact: false });
  await hui.contextMenu(content);
  await screen.getByText("Copy as markdown").tap();
  await expect.poll(() => hui.copied()).toBe("Real SDK browser fixture\n");
});

test("another tool shows its state, input and output, with Copy output", { tags: ["CHAT-028"] }, async ({ screen, hui }) => {
  const message = screen.getByLabel("Message");
  const send = screen.getByRole("button", "Send message");
  const transcript = screen.getByTestId("transcript");
  const idle = screen.getByLabel("Session status: Idle");
  await hui.clipboard();
  await openSession(hui, "Other tools");
  await expect(idle).toBeVisible();

  await message.fill(call("HOLD", "fixture_echo", { text: "from the model" }));
  await send.tap();
  await hui.provider.held();
  await hui.scrollTo(transcript, transcript.getByText("Using 1 tool"));
  const echo = transcript.getByRole("button", /^Using fixture echo/u);
  if (!(await echo.isVisible())) await transcript.getByText("Using 1 tool").tap();
  await hui.scrollTo(transcript, echo);
  await echo.tap();
  await expect(transcript.getByText("Using fixture echo")).toBeVisible();
  await expect(transcript.getByText("Input")).toBeVisible();
  await hui.provider.release();
  await expect(idle).toBeVisible();
  await expect(transcript.getByText("Used fixture echo")).toBeVisible();
  await expect(transcript.getByText("Input")).toBeVisible();
  await expect(transcript.getByText(/"text": "from the model"/u)).toBeVisible();
  await expect(transcript.getByText("Output")).toBeVisible();
  await expect(transcript.getByText("Extension tool executed: from the model")).toBeVisible();
  await hui.scrollTo(transcript, transcript.getByRole("button", "Copy output"));
  await transcript.getByRole("button", "Copy output").tap();
  await expect.poll(() => hui.copied()).toBe("Extension tool executed: from the model");

  await message.fill(call("CALL", "fixture_echo", { text: "" }));
  await send.tap();
  await expect(transcript.getByText(/^tool answered: /u).last()).toBeVisible();
  await expect(idle).toBeVisible();
  await hui.scrollTo(transcript, transcript.getByText("Used 1 tool").last());
  const empty = transcript.getByRole("button", /^Used fixture echo/u).last();
  if (!(await empty.isVisible())) await transcript.getByText("Used 1 tool").last().tap();
  await hui.scrollTo(transcript, empty);
  await empty.tap();
  await expect(transcript.getByText("No output")).toBeVisible();

  await openSession(hui, "Failed tool");
  await message.fill(call("CALL", "fixture_echo", { text: "fail" }));
  await send.tap();
  await expect(transcript.getByText(/^tool answered: /u)).toBeVisible();
  await expect(idle).toBeVisible();
  await hui.scrollTo(transcript, transcript.getByText("Used 1 tool"));
  const failedTool = transcript.getByRole("button", /^Used fixture echo/u);
  if (!(await failedTool.isVisible())) await transcript.getByText("Used 1 tool").tap();
  await hui.scrollTo(transcript, failedTool);
  await failedTool.tap();
  await expect(transcript.getByText("Used fixture echo")).toBeVisible();
  await expect(transcript.getByText("Fixture echo failed on purpose.")).toBeVisible();
});

test("a failed tool call keeps its error live and after a reload", { tags: ["CHAT-029"] }, async ({ screen, hui }) => {
  const transcript = screen.getByTestId("transcript");
  await openSession(hui, "Failed read");
  await screen.getByLabel("Message").fill("E2E_TOOL_FAILURE");
  await screen.getByRole("button", "Send message").tap();
  await expect(transcript.getByText("Tool complete")).toBeVisible();
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();

  for (const pass of ["live", "reloaded"]) {
    if (pass === "reloaded") await hui.reload();
    await hui.scrollTo(transcript, transcript.getByText("Used 1 tool"));
    const read = transcript.getByRole("button", /^Read missing\.txt/u);
    if (!(await read.isVisible())) await transcript.getByText("Used 1 tool").tap();
    await hui.scrollTo(transcript, read);
    await read.tap();
    await expect(transcript.getByText("failed", { exact: true })).toBeVisible();
    await expect(transcript.getByText("Tool error")).toBeVisible();
    await expect(transcript.getByText(/ENOENT.*missing\.txt/u)).toBeVisible();
  }
});
