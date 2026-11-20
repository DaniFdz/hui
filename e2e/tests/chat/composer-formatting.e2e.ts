/** The composer's Markdown paint and the keys that shape it: the draft's bold, italic, code, fence and lists under the textarea while its value stays the exact Markdown, the same Markdown in the sent prompt, and the list and wrap keys (CHAT-091, CHAT-092). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

const DRAFT = [
  "Ship **bold**, *italic* and `npm test`:",
  "```ts",
  "const a = 1;",
  "```",
  "- bullet",
  "  1. nested",
].join("\n");

test("the composer paints the draft's Markdown under the textarea and the sent prompt renders it", { tags: ["CHAT-091"] }, async ({ screen, hui }) => {
  const message = screen.getByLabel("Message");
  const mirror = screen.getByTestId("composer-mirror");
  const transcript = screen.getByTestId("transcript");
  const idle = screen.getByLabel("Session status: Idle");

  const session = await hui.createSession({ title: "Formatted draft" });
  await hui.open(`/sessions/${session.id}`);
  await expect(idle).toBeVisible();
  const oneLine = (await message.boundingBox())?.height ?? Number.NaN;

  await message.fill(DRAFT);
  // The textarea stays the editor and its value stays the Markdown: the paint is a second layer, never an edit.
  await expect(message).toHaveValue(DRAFT);

  // Each run carries only its own decoration, and the fence, the bullet and the number keep their lines.
  await expect(mirror.getByText("bold", { exact: true })).toHaveAttribute("class", /hui-draft-bold/u);
  await expect(mirror.getByText("italic", { exact: true })).toHaveAttribute("class", /hui-draft-italic/u);
  await expect(mirror.getByText("npm test", { exact: true })).toHaveAttribute("class", /hui-draft-code/u);
  await expect(mirror.getByText("```ts", { exact: true })).toHaveAttribute("class", /hui-draft-line--fence-open/u);
  await expect(mirror.getByText("-", { exact: true })).toHaveAttribute("class", /hui-draft-marker--bullet/u);
  await expect(mirror.getByText("1.", { exact: true })).toHaveAttribute("class", /hui-draft-marker--ordered/u);

  // Every source marker stays where the operator typed it, dimmed: the draft is still Markdown.
  await expect(mirror.getByText("**", { exact: true })).toHaveCount(2);
  await expect(mirror.getByText("**", { exact: true }).first()).toHaveAttribute("class", /hui-draft-marker/u);

  // The paint is the textarea's own box, and the composer grew with the draft instead of scrolling one line.
  const mirrorBox = await mirror.boundingBox();
  const messageBox = await message.boundingBox();
  expect(Math.abs((mirrorBox?.width ?? Number.NaN) - (messageBox?.width ?? Number.NaN))).toBeLessThanOrEqual(1);
  expect(messageBox?.height ?? Number.NaN).toBeGreaterThan(oneLine);

  await screen.getByRole("button", "Send message").tap();
  await expect(transcript.getByText("const a = 1;")).toBeVisible();
  await expect(transcript.getByText("Fixture response.")).toBeVisible();
  await expect(idle).toBeVisible();
  await expect(message).toHaveValue("");

  // The operator's prompt renders the Markdown the composer previewed: no source marker survives.
  await expect(transcript.getByText("**bold**")).toHaveCount(0);
  await expect(transcript.getByText("bold", { exact: true })).toBeVisible();
  await expect(transcript.getByText("italic", { exact: true })).toBeVisible();
  await expect(transcript.getByText("npm test", { exact: true })).toBeVisible();
  await expect(transcript.getByText("```ts")).toHaveCount(0);
  await expect(transcript.getByRole("list").first()).toBeVisible();
  // The ordered item is nested under the bullet, not a sibling list: a bare "second list item" read passes either way.
  const prompt = transcript.getByTestId("message-row").filter({ hasText: "bullet" });
  await expect(prompt.getByRole("listitem").first().getByRole("list").first()).toBeVisible();
  await expect(prompt.getByRole("listitem").first().getByRole("listitem").first()).toHaveText(/nested/u);

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

test("Tab nests a list and leaves a plain draft, Enter ends an empty item, and the bold chord undoes", { tags: ["CHAT-092"], platforms: ["web"] }, async ({ screen, hui }) => {
  const message = screen.getByLabel("Message");
  const transcript = screen.getByTestId("transcript");
  const idle = screen.getByLabel("Session status: Idle");

  const session = await hui.createSession({ title: "Composer keys" });
  await hui.open(`/sessions/${session.id}`);
  await expect(idle).toBeVisible();
  const settled = await hui.textOf(transcript);

  // Three spaces a level, three levels, and Shift+Tab gives the indent back.
  await message.fill("- item");
  await expect(message).toHaveValue("- item");
  await message.press("Tab");
  await expect(message).toHaveValue("   - item");
  await message.press("Shift+Tab");
  await expect(message).toHaveValue("- item");
  await message.press("Tab");
  await expect(message).toHaveValue("   - item");
  await message.press("Tab");
  await expect(message).toHaveValue("      - item");
  await message.press("Tab");
  await expect(message).toHaveValue("         - item");

  // A draft with no list is the browser's to move through: the key reaches the next control.
  await message.fill("plain prose");
  await expect(message).toBeFocused();
  await message.press("Tab");
  await expect(message).not.toBeFocused();

  // Enter on an empty list item ends the list instead of sending it.
  await message.fill("- ");
  await expect(message).toHaveValue("- ");
  await message.press("Enter");
  await expect(message).toHaveValue("");
  await expect(idle).toBeVisible();
  expect(await hui.textOf(transcript)).toBe(settled);
  await expect(transcript.getByText("Start a conversation")).toBeVisible();

  // One chord wraps the selection in bold, and the browser's own undo puts the draft back.
  await message.fill("- item");
  await message.press("ControlOrMeta+a");
  await message.press("ControlOrMeta+b");
  await expect(message).toHaveValue("**- item**");
  await message.press("ControlOrMeta+z");
  await expect(message).toHaveValue("- item");
  await expect(idle).toBeVisible();
});
