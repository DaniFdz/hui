/**
 * A quote's `[!NOTE]` marker becomes the transcript's callout in the rich composer, and Backspace on the empty line Enter
 * leaves is the way out (CHAT-096). Enter on the marker opens the note of its kind — the aside titled Note, Tip,
 * Important, Warning or Caution with the body under its title — and the space that completes the marker opens it too. A
 * note writes canonical Markdown (`> [!NOTE]` and its body, `> ` on every line), so the draft it came from loads rich
 * again after a reload, and the note keeps the typed text when the operator leaves it. A plain quote is not a note and a
 * marker no kind names stays quote text. Enter never sends from a quote or a note: the seeded reply stays the transcript's
 * only one, so the send is always the Send button, which is also what a phone presses.
 */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

/** The five kinds and the title the transcript's own label map draws for each. */
const KINDS: readonly [marker: string, title: string][] = [["NOTE", "Note"], ["TIP", "Tip"], ["IMPORTANT", "Important"], ["WARNING", "Warning"], ["CAUTION", "Caution"]];

test("Enter on a note's marker draws the callout, and Backspace on its empty line leaves it", { tags: ["CHAT-096"] }, async ({ screen, hui }) => {
  const message = screen.getByLabel("Message");
  const wire = screen.getByTestId("composer-markdown");
  const transcript = screen.getByTestId("transcript", { visible: true });
  const idle = screen.getByLabel("Session status: Idle");

  const session = await hui.createSession({ title: "Notes in the composer" });
  await hui.open(`/sessions/${session.id}`);
  await expect(idle).toBeVisible();
  // One reply is already in the transcript, so an Enter that sent by mistake would show up as a second one.
  await hui.prompt(session, "Seed the transcript");
  await expect(transcript.getByText("Fixture response.")).toHaveCount(1);
  await expect(idle).toBeVisible();

  // `>` and its space open a quote; the marker typed in it opens the note on Enter, with no marker left in the draft.
  await message.pressSequentially("> ");
  await expect(wire).toHaveValue("> ");
  await message.pressSequentially("[!NOTE]");
  await message.press("Enter");
  await expect(wire).toHaveValue("> [!NOTE]");
  const note = message.getByLabel("Note");
  await expect(note).toHaveCount(1);
  await expect(note.getByText("Note", { exact: true })).toBeVisible();
  await expect(message).not.toContainText("[!NOTE]");
  await expect(transcript.getByText("Fixture response.")).toHaveCount(1);

  // The body is the note's, and its wire is the marker line and the body with `> ` on every line.
  await message.pressSequentially("The note body.");
  await expect(wire).toHaveValue("> [!NOTE]\n> The note body.");
  await expect(note).toContainText("The note body.");

  // Enter inside the note adds a line inside it: a second paragraph, which the wire writes under a `>` line.
  await message.press("Enter");
  await message.pressSequentially("A second line.");
  await expect(wire).toHaveValue("> [!NOTE]\n> The note body.\n>\n> A second line.");
  await expect(note).toContainText("A second line.");
  await expect(transcript.getByText("Fixture response.")).toHaveCount(1);

  // Enter, Enter and Backspace on the empty line they leave is the way out, with the typed text kept.
  await message.press("Enter");
  await message.press("Enter");
  await message.press("Backspace");
  await expect(wire).toHaveValue("> [!NOTE]\n> The note body.\n>\n> A second line.");
  await message.pressSequentially("After the note.");
  await expect(wire).toHaveValue("> [!NOTE]\n> The note body.\n>\n> A second line.\n\nAfter the note.");
  // The caret is in a plain paragraph, not in the callout: the prose is outside the aside the note draws.
  await expect(note).not.toContainText("After the note.");
  await expect(note).toContainText("The note body.");
  await expect(transcript.getByText("Fixture response.")).toHaveCount(1);

  // The draft is canonical Markdown, so the reloaded draft loads as the same rich note rather than as literal text.
  await hui.reload();
  await expect(idle).toBeVisible();
  await expect(wire).toHaveValue("> [!NOTE]\n> The note body.\n>\n> A second line.\n\nAfter the note.");
  const reloaded = message.getByLabel("Note");
  await expect(reloaded).toHaveCount(1);
  await expect(reloaded.getByText("Note", { exact: true })).toBeVisible();
  await expect(reloaded).toContainText("The note body.");
  await expect(message).not.toContainText("[!NOTE]");

  await screen.getByRole("button", "Send message").tap();
  await expect(transcript.getByText("Fixture response.")).toHaveCount(2);
  await expect(idle).toBeVisible();
  await expect(wire).toHaveValue("");
  // The sent prompt is the same Markdown: the transcript draws the same callout, with no marker anywhere.
  const sent = transcript.getByTestId("message-row").filter({ hasText: "After the note." });
  const callout = sent.getByLabel("Note");
  await expect(callout.getByText("Note", { exact: true })).toBeVisible();
  await expect(callout).toContainText("The note body.");
  await expect(callout).toContainText("A second line.");
  await expect(sent.getByText("After the note.")).toBeVisible();
  await expect(transcript).not.toContainText("[!NOTE]");
});

test("a plain quote and an unknown marker stay text, and each of the five kinds draws its title", { tags: ["CHAT-096"] }, async ({ screen, hui }) => {
  const message = screen.getByLabel("Message");
  const wire = screen.getByTestId("composer-markdown");
  const transcript = screen.getByTestId("transcript", { visible: true });
  const idle = screen.getByLabel("Session status: Idle");

  const session = await hui.createSession({ title: "Quotes and notes" });
  await hui.open(`/sessions/${session.id}`);
  await expect(idle).toBeVisible();
  await hui.prompt(session, "Seed the transcript");
  await expect(transcript.getByText("Fixture response.")).toHaveCount(1);
  await expect(idle).toBeVisible();

  /** Empties the draft from the keyboard: the selection is every block it holds, and Delete takes them all. */
  const clear = async () => {
    await message.press("ControlOrMeta+a");
    await message.press("Delete");
    await expect(wire).toHaveValue("");
  };

  // A quote with no marker is a plain quote, and Enter inside it adds a line instead of sending.
  await message.pressSequentially("> ");
  await message.pressSequentially("Just a quote");
  await expect(wire).toHaveValue("> Just a quote");
  await expect(message.getByLabel("Note")).toHaveCount(0);
  await message.press("Enter");
  await message.pressSequentially("and its second line");
  await expect(wire).toHaveValue("> Just a quote\n>\n> and its second line");
  await expect(message.getByLabel("Note")).toHaveCount(0);
  await expect(transcript.getByText("Fixture response.")).toHaveCount(1);

  // The same gesture leaves the quote: the empty lines go, the text stays, and the prose lands below the block.
  await message.press("Enter");
  await message.press("Enter");
  await message.press("Backspace");
  await expect(wire).toHaveValue("> Just a quote\n>\n> and its second line");
  await message.pressSequentially("After the quote.");
  await expect(wire).toHaveValue("> Just a quote\n>\n> and its second line\n\nAfter the quote.");
  await expect(message.getByLabel("Note")).toHaveCount(0);
  await expect(transcript.getByText("Fixture response.")).toHaveCount(1);
  await clear();

  // A marker no kind names stays quote text, and Enter there is the quote's own line, not a note. The wire is the
  // quote's own line too, with the escaping a line that would read as syntax gets; which of the writer's two passes
  // spells it is not what this case is about.
  await message.pressSequentially("> ");
  await message.pressSequentially("[!FOO]");
  await expect(message).toHaveValue("[!FOO]");
  await expect(message.getByLabel("Note")).toHaveCount(0);
  await expect(wire).toHaveValue(/^> \\?\[\\?!FOO\\?\]$/u);
  await message.press("Enter");
  await expect(message.getByLabel("Note")).toHaveCount(0);
  await expect(wire).toHaveValue(/^> \\?\[\\?!FOO\\?\]$/u);
  await expect(transcript.getByText("Fixture response.")).toHaveCount(1);
  await clear();

  // Each of the five kinds opens the callout its marker names, with the transcript's own title, and each is left the
  // same way: two Enters add the empty line, and Backspace on it puts the caret in the prose below.
  for (const [marker, title] of KINDS) {
    await message.pressSequentially("> ");
    await message.pressSequentially(`[!${marker}] `);
    const callout = message.getByLabel(title);
    await expect(callout).toHaveCount(1);
    await expect(callout.getByText(title, { exact: true })).toBeVisible();
    await expect(wire).toHaveValue(`> [!${marker}]`);
    await message.pressSequentially(`The ${title.toLowerCase()} body.`);
    await expect(wire).toHaveValue(`> [!${marker}]\n> The ${title.toLowerCase()} body.`);
    await expect(callout).toContainText(`The ${title.toLowerCase()} body.`);
    await message.press("Enter");
    await message.press("Enter");
    await message.press("Backspace");
    await message.pressSequentially("after it");
    await expect(wire).toHaveValue(`> [!${marker}]\n> The ${title.toLowerCase()} body.\n\nafter it`);
    await expect(callout).not.toContainText("after it");
    // Nothing was sent by any of it: the seeded reply is still the transcript's only one.
    await expect(transcript.getByText("Fixture response.")).toHaveCount(1);
    await clear();
  }
});
