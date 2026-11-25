/**
 * A fence starts and ends on the Enter key in the rich composer (CHAT-095). Typing ```ts and pressing Enter opens a
 * code block with that language instead of sending the draft, and the block takes its lines on Enter; ArrowDown at the
 * block's end and Enter on a closing ``` line both leave it for the paragraph after, and so does Backspace on the empty
 * line Enter adds, which keeps the block's own text. Each exit leaves the draft writing the paragraph one blank line
 * below the fence. Nothing here sends with plain Enter: the phone treats Enter as a line break, so the send is always the
 * Send button.
 */
import { expect, type Locator, type Role } from "e2e";
import { test } from "../../fixtures/hui.ts";

/**
 * The draft's rendered code. The engine names `<code>` with HTML-AAM's `code` role, and the SDK's `Role` union lists only
 * the widget vocabulary, so the name is cast to it: the query built is the same one `getByRole` builds for every role.
 */
const code = (target: Locator) => target.getByRole("code" as Role);

test("Enter opens a fence with its language and ArrowDown leaves it", { tags: ["CHAT-095"] }, async ({ screen, hui }) => {
  const message = screen.getByLabel("Message");
  const wire = screen.getByTestId("composer-markdown");
  const transcript = screen.getByTestId("transcript", { visible: true });
  const idle = screen.getByLabel("Session status: Idle");

  const session = await hui.createSession({ title: "Fence on Enter" });
  await hui.open(`/sessions/${session.id}`);
  await expect(idle).toBeVisible();
  // One reply is already in the transcript, so a draft that Enter sent by mistake would show up as a second one.
  await hui.prompt(session, "Seed the transcript");
  await expect(transcript.getByText("Fixture response.")).toHaveCount(1);
  await expect(idle).toBeVisible();

  await message.pressSequentially("```ts");
  await expect(message).toHaveText("```ts");
  await message.press("Enter");
  // Enter opened the block instead of sending: the draft stays, and no prompt joined the transcript.
  await expect(wire).toHaveValue("```ts\n```");
  await expect(transcript.getByText("Fixture response.")).toHaveCount(1);
  await expect(code(message)).toHaveCount(1);
  await expect(message).not.toContainText("```");

  await message.pressSequentially("const a = 1;");
  await message.press("Enter");
  await message.pressSequentially("return a;");
  await expect(wire).toHaveValue("```ts\nconst a = 1;\nreturn a;\n```");
  await expect(code(message)).toHaveText("const a = 1; return a;");

  // ArrowDown at the block's end is the caret's way out: the block keeps both lines and the prose goes below it.
  await message.press("ArrowDown");
  await expect(code(message)).toHaveText("const a = 1; return a;");
  await message.pressSequentially("after the block");
  await expect(wire).toHaveValue("```ts\nconst a = 1;\nreturn a;\n```\n\nafter the block");
  await expect(transcript.getByText("Fixture response.")).toHaveCount(1);

  await screen.getByRole("button", "Send message").tap();
  await expect(transcript.getByText("Fixture response.")).toHaveCount(2);
  await expect(idle).toBeVisible();
  await expect(wire).toHaveValue("");
  // The sent prompt is the same Markdown: a code block over its two lines and the prose below it, no marker in sight.
  const sent = transcript.getByTestId("message-row").filter({ hasText: "after the block" });
  await expect(code(sent)).toHaveText("const a = 1; return a;");
  await expect(sent.getByText("after the block")).toBeVisible();
  await expect(transcript).not.toContainText("```ts");
});

test("Enter on a closing ``` line leaves the block", { tags: ["CHAT-095"] }, async ({ screen, hui }) => {
  const message = screen.getByLabel("Message");
  const wire = screen.getByTestId("composer-markdown");
  const transcript = screen.getByTestId("transcript", { visible: true });
  const idle = screen.getByLabel("Session status: Idle");

  const session = await hui.createSession({ title: "Closing fence" });
  await hui.open(`/sessions/${session.id}`);
  await expect(idle).toBeVisible();

  // A bare fence opens on Enter too, with no language and no marker in the draft.
  await message.pressSequentially("```");
  await message.press("Enter");
  await expect(wire).toHaveValue("```\n```");
  await expect(code(message)).toHaveCount(1);
  await expect(message).not.toContainText("```");

  await message.pressSequentially("const a = 1;");
  await message.press("Enter");
  await message.pressSequentially("return a;");
  await expect(wire).toHaveValue("```\nconst a = 1;\nreturn a;\n```");

  // Enter on a line that is only ``` closes the fence: that line goes, and the caret is in the paragraph after it.
  await message.press("Enter");
  await message.pressSequentially("```");
  await expect(code(message)).toHaveText("const a = 1; return a; ```");
  await message.press("Enter");
  await expect(code(message)).toHaveText("const a = 1; return a;");
  await message.pressSequentially("after the block");
  await expect(wire).toHaveValue("```\nconst a = 1;\nreturn a;\n```\n\nafter the block");

  await screen.getByRole("button", "Send message").tap();
  await expect(transcript.getByText("Fixture response.")).toHaveCount(1);
  await expect(idle).toBeVisible();
  await expect(wire).toHaveValue("");
  const sent = transcript.getByTestId("message-row").filter({ hasText: "after the block" });
  await expect(code(sent)).toHaveText("const a = 1; return a;");
  await expect(sent.getByText("after the block")).toBeVisible();
  await expect(transcript).not.toContainText("```");
});

test("Backspace on the empty line Enter adds leaves the fence with its text", { tags: ["CHAT-095"] }, async ({ screen, hui }) => {
  const message = screen.getByLabel("Message");
  const wire = screen.getByTestId("composer-markdown");
  const transcript = screen.getByTestId("transcript", { visible: true });
  const idle = screen.getByLabel("Session status: Idle");

  const session = await hui.createSession({ title: "Leaving a fence" });
  await hui.open(`/sessions/${session.id}`);
  await expect(idle).toBeVisible();
  // One reply is already in the transcript, so an Enter that sent by mistake would show up as a second one.
  await hui.prompt(session, "Seed the transcript");
  await expect(transcript.getByText("Fixture response.")).toHaveCount(1);
  await expect(idle).toBeVisible();

  await message.pressSequentially("```ts");
  await message.press("Enter");
  await message.pressSequentially("const a = 1;");
  await expect(wire).toHaveValue("```ts\nconst a = 1;\n```");
  await expect(code(message)).toHaveText("const a = 1;");

  // Enter adds a line inside the fence, and a second one adds another: both are the block's own lines, never a send.
  await message.press("Enter");
  await message.press("Enter");
  await expect(wire).toHaveValue("```ts\nconst a = 1;\n\n```");
  await expect(code(message)).toHaveText("const a = 1;");
  await expect(transcript.getByText("Fixture response.")).toHaveCount(1);

  // Backspace on that empty line is the way out, with the fence keeping the text typed into it.
  await message.press("Backspace");
  await expect(wire).toHaveValue("```ts\nconst a = 1;\n```");
  await expect(code(message)).toHaveText("const a = 1;");
  await message.pressSequentially("after the fence");
  await expect(wire).toHaveValue("```ts\nconst a = 1;\n```\n\nafter the fence");
  // The typed prose is a plain paragraph below the block, not a line of the fence.
  await expect(code(message)).toHaveText("const a = 1;");
  await expect(transcript.getByText("Fixture response.")).toHaveCount(1);

  await screen.getByRole("button", "Send message").tap();
  await expect(transcript.getByText("Fixture response.")).toHaveCount(2);
  await expect(idle).toBeVisible();
  await expect(wire).toHaveValue("");
  const sent = transcript.getByTestId("message-row").filter({ hasText: "after the fence" });
  await expect(code(sent)).toHaveText("const a = 1;");
  await expect(sent.getByText("after the fence")).toBeVisible();
  await expect(transcript).not.toContainText("```");
});
