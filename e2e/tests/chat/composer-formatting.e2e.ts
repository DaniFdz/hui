/**
 * The composer is the rich editor, never a textarea with Markdown in it: typing `**bold**`, `*italic*`, `` `code` ``,
 * a bullet with a nested item or a fence converts on the keystroke that closes the run, so the editor draws the
 * formatting and no source marker; the hidden field carries the canonical Markdown a textarea would have sent, and the
 * sent prompt renders it (CHAT-091). Enter splits a list item and Tab nests it, Enter on an empty item ends the list,
 * the formatting chords toggle and undo, and arithmetic and a file name stay literal (CHAT-092). A draft the editor
 * cannot draw loads as its own text, shown and sent byte for byte, with no Markdown control and no source editor
 * (CHAT-093).
 */
import { expect, type Locator, type Role } from "e2e";
import { test } from "../../fixtures/hui.ts";

/** A Markdown table: a construct the rich schema has no node for, so the draft can only be edited as source. */
const TABLE = "| name | count |\n| --- | --- |\n| alpha | 1 |\n| beta | 2 |";

/**
 * One rendered inline mark. The engine's semantic reader names `strong`, `emphasis` and `code` as HTML-AAM roles, and the
 * SDK's `Role` union lists only the widget vocabulary, so the name is cast to it: the query built is the same one
 * `getByRole` builds for every other role.
 */
const mark = (target: Locator, name: "strong" | "emphasis" | "code") => target.getByRole(name as Role);

test("a typed draft draws its formatting with no marker and sends the canonical Markdown", { tags: ["CHAT-091"] }, async ({ screen, hui }) => {
  const message = screen.getByLabel("Message");
  const wire = screen.getByTestId("composer-markdown");
  const transcript = screen.getByTestId("transcript", { visible: true });
  const idle = screen.getByLabel("Session status: Idle");

  const session = await hui.createSession({ title: "Formatted draft" });
  await hui.open(`/sessions/${session.id}`);
  await expect(idle).toBeVisible();
  // One rich editor and no Markdown control: the composer has no source box to fall back to, so one visible surface is
  // labeled Message.
  await expect(screen.getByRole("button", "Markdown")).toHaveCount(0);
  await expect(screen.getByLabel("Message", { visible: true })).toHaveCount(1);

  // Typing closes each run, so the markers become the marks they name and the editor draws no marker at all.
  await message.pressSequentially("Hello **bold** and *italic* with `code`:");
  await expect(message).toHaveValue("Hello bold and italic with code:");
  await expect(mark(message, "strong")).toHaveText("bold");
  await expect(mark(message, "emphasis")).toHaveText("italic");
  await expect(mark(message, "code")).toHaveText("code");
  // The wire is the Markdown a textarea would have sent: the editor's own value is only what it draws.
  await expect(wire).toHaveValue("Hello **bold** and *italic* with `code`:");

  await screen.getByRole("button", "Send message").tap();
  await expect(transcript.getByText("Fixture response.")).toBeVisible();
  await expect(idle).toBeVisible();
  await expect(wire).toHaveValue("");

  // The operator's own prompt renders that Markdown: no source marker survives in the transcript.
  const sent = transcript.getByTestId("message-row").filter({ hasText: "Hello" });
  await expect(mark(sent, "strong")).toHaveText("bold");
  await expect(mark(sent, "emphasis")).toHaveText("italic");
  await expect(mark(sent, "code")).toHaveText("code");
  await expect(transcript.getByText("**bold**")).toHaveCount(0);

  // Enter splits a typed bullet and Tab nests it: the wire carries the three spaces per level Markdown needs, and the
  // editor draws the nested list without a marker.
  await message.pressSequentially("- one");
  await expect(wire).toHaveValue("- one");
  await message.press("Enter");
  await message.pressSequentially("two");
  await expect(wire).toHaveValue("- one\n- two");
  await message.press("Tab");
  await expect(wire).toHaveValue("- one\n   - two");
  await expect(message).toHaveValue("one\n\ntwo");
  await expect(message.getByRole("list")).toHaveCount(2);
  await expect(message.getByRole("listitem")).toHaveCount(2);
  await expect(message.getByRole("listitem").first().getByRole("listitem")).toHaveText("two");

  await screen.getByRole("button", "Send message").tap();
  await expect(transcript.getByText("Fixture response.")).toHaveCount(2);
  await expect(idle).toBeVisible();
  // The nested item is drawn under its parent, not as a second top-level list.
  const nested = transcript.getByTestId("message-row").filter({ hasText: "one" });
  await expect(nested.getByRole("listitem").first().getByRole("listitem")).toHaveText("two");

  // A typed fence takes its language and its lines, and draws no backtick.
  await message.pressSequentially("```ts ");
  await expect(message).toHaveValue("");
  await message.pressSequentially("const a = 1;");
  await message.press("Enter");
  await message.pressSequentially("return a;");
  await expect(message).toHaveValue("const a = 1;\nreturn a;");
  await expect(mark(message, "code")).toHaveText("const a = 1; return a;");
  await expect(wire).toHaveValue("```ts\nconst a = 1;\nreturn a;\n```");

  await screen.getByRole("button", "Send message").tap();
  await expect(transcript.getByText("Fixture response.")).toHaveCount(3);
  await expect(idle).toBeVisible();
  const fenced = transcript.getByTestId("message-row").filter({ hasText: "const a = 1;" });
  await expect(mark(fenced, "code")).toHaveText("const a = 1; return a;");
  await expect(transcript.getByText("```ts")).toHaveCount(0);

  // HUI's own prompts are machine text: a routine's and a trigger's markers stay markers.
  await hui.prompt(session, "[routine: Digest] **Summarize**");
  await expect(transcript.getByText("**Summarize**")).toBeVisible();
  await expect(transcript.getByText("Summarize", { exact: true })).toHaveCount(0);
  await expect(idle).toBeVisible();
  await hui.prompt(session, "[trigger: PR merged · #7] **Checks** passed");
  await expect(transcript.getByText("**Checks** passed")).toBeVisible();
  await expect(transcript.getByText("Checks", { exact: true })).toHaveCount(0);
  await expect(idle).toBeVisible();
});

test("Enter splits and ends a list, Tab nests it, and the chords toggle and undo", { tags: ["CHAT-092"], platforms: ["web"] }, async ({ screen, hui }) => {
  const message = screen.getByLabel("Message");
  const wire = screen.getByTestId("composer-markdown");
  const transcript = screen.getByTestId("transcript", { visible: true });
  const idle = screen.getByLabel("Session status: Idle");

  const session = await hui.createSession({ title: "Composer keys" });
  await hui.open(`/sessions/${session.id}`);
  await expect(idle).toBeVisible();

  // In prose Enter sends, and only Send's own prompt appears: nothing was added around it.
  await message.pressSequentially("Sent with Enter");
  await message.press("Enter");
  await expect(transcript.getByText("Sent with Enter")).toBeVisible();
  await expect(transcript.getByText("Fixture response.")).toBeVisible();
  await expect(idle).toBeVisible();
  await expect(wire).toHaveValue("");

  // Enter splits a list item and Tab sinks it under the item above, three spaces a level; Shift+Tab lifts it back.
  await message.pressSequentially("- one");
  await expect(wire).toHaveValue("- one");
  await message.press("Enter");
  await message.pressSequentially("two");
  await expect(wire).toHaveValue("- one\n- two");
  await message.press("Tab");
  await expect(wire).toHaveValue("- one\n   - two");
  await expect(message.getByRole("listitem").first().getByRole("listitem")).toHaveText("two");
  await message.press("Shift+Tab");
  await expect(wire).toHaveValue("- one\n- two");
  await expect(transcript.getByText("Fixture response.")).toHaveCount(1);

  // Enter on an empty item ends the list instead of sending it: the draft empties and no prompt is added.
  await message.fill("");
  await message.pressSequentially("- ");
  await expect(wire).toHaveValue("- ");
  await message.press("Enter");
  await expect(wire).toHaveValue("");
  await expect(message).toHaveValue("");
  await expect(transcript.getByText("Fixture response.")).toHaveCount(1);
  await expect(idle).toBeVisible();

  // One chord wraps the selection, and Cmd/Ctrl+Z puts the draft back as it was.
  await message.pressSequentially("plain words");
  await expect(wire).toHaveValue("plain words");
  await message.press("ControlOrMeta+a");
  await message.press("ControlOrMeta+b");
  await expect(wire).toHaveValue("**plain words**");
  await expect(mark(message, "strong")).toHaveText("plain words");
  await message.press("ControlOrMeta+z");
  await expect(wire).toHaveValue("plain words");
  await expect(mark(message, "strong")).toHaveCount(0);

  // The other two chords do the same for italic and inline code.
  await message.press("ControlOrMeta+a");
  await message.press("ControlOrMeta+i");
  await expect(wire).toHaveValue("*plain words*");
  await expect(mark(message, "emphasis")).toHaveText("plain words");
  await message.press("ControlOrMeta+z");
  await message.press("ControlOrMeta+a");
  await message.press("ControlOrMeta+e");
  await expect(wire).toHaveValue("`plain words`");
  await expect(mark(message, "code")).toHaveText("plain words");
  await message.press("ControlOrMeta+z");
  await expect(wire).toHaveValue("plain words");

  // Arithmetic and a file name are not syntax: they stay exactly as typed, in the editor and on the wire.
  await message.fill("");
  await message.pressSequentially("2 * 3 * 4 read_text_file");
  await expect(message).toHaveValue("2 * 3 * 4 read_text_file");
  await expect(wire).toHaveValue("2 * 3 * 4 read_text_file");
  await expect(mark(message, "emphasis")).toHaveCount(0);
  await expect(mark(message, "strong")).toHaveCount(0);

  // A draft with no list is the browser's to move through: the key reaches the next control.
  await message.fill("");
  await message.pressSequentially("plain prose");
  await expect(message).toBeFocused();
  await message.press("Tab");
  await expect(message).not.toBeFocused();
});

test("a draft the rich editor cannot draw keeps its own text, edits as plain text and sends its bytes", { tags: ["CHAT-093"] }, async ({ screen, hui }) => {
  const message = screen.getByLabel("Message");
  const wire = screen.getByTestId("composer-markdown");
  const transcript = screen.getByTestId("transcript", { visible: true });
  const idle = screen.getByLabel("Session status: Idle");

  const session = await hui.createSession({ title: "Literal draft" });
  await hui.open(`/sessions/${session.id}`);
  await expect(idle).toBeVisible();
  // The table is a prompt the operator sent, so the transcript draws it as a table.
  await hui.prompt(session, TABLE);
  await expect(transcript.getByRole("table")).toBeVisible();
  await expect(transcript.getByText("Fixture response.")).toBeVisible();
  await expect(idle).toBeVisible();

  // Rewind to here gives the prompt back. A table has no node in the rich schema, so the composer shows its own text:
  // the pipes and dashes stay visible, no table is drawn in the composer, and the hidden field carries exactly those bytes.
  await transcript.getByRole("button", "Rewind to here").tap();
  await expect(screen.getByText("Message restored to the composer. The previous branch is kept.")).toBeVisible();
  await expect(wire).toHaveValue(TABLE);
  await expect(message).toHaveValue(TABLE);
  await expect(message.getByRole("table")).toHaveCount(0);
  await expect(screen.getByRole("button", "Markdown")).toHaveCount(0);

  // Formatting does not convert in that text: a chord over the whole draft changes nothing, and a typed marker stays text.
  await message.press("ControlOrMeta+a");
  await message.press("ControlOrMeta+b");
  await expect(wire).toHaveValue(TABLE);
  await expect(mark(message, "strong")).toHaveCount(0);
  await message.press("ControlOrMeta+End");
  await message.pressSequentially(" **bold**");
  await expect(wire).toHaveValue(`${TABLE} **bold**`);
  await expect(mark(message, "strong")).toHaveCount(0);
  await message.fill(TABLE);
  await expect(wire).toHaveValue(TABLE);

  // Sending posts those bytes: the transcript draws the table, and the send's clear loads the rich editor again.
  await screen.getByRole("button", "Send message").tap();
  await expect(transcript.getByText("Fixture response.")).toBeVisible();
  await expect(idle).toBeVisible();
  await expect(transcript.getByRole("table")).toHaveCount(1);
  await expect(transcript.getByRole("columnheader")).toHaveText(["name", "count"]);
  await expect(transcript.getByRole("cell")).toHaveText(["alpha", "1", "beta", "2"]);
  await expect(transcript.getByText("| name | count |")).toHaveCount(0);
  await expect(wire).toHaveValue("");

  await message.pressSequentially("Back **rich**");
  await expect(message).toHaveValue("Back rich");
  await expect(wire).toHaveValue("Back **rich**");
  await expect(mark(message, "strong")).toHaveText("rich");
  await expect(screen.getByRole("button", "Markdown")).toHaveCount(0);
});
