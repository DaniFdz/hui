/** A reply's plain Markdown: headings, nested lists, strikethrough, quotes and task items render as formatted text with
 * escaped raw HTML, and the web and email addresses in prose become links without swallowing their punctuation
 * (RICH-001, RICH-002). */
import { expect, type Locator, type Screen } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";

async function reply(screen: Screen, hui: Hui, markdown: string, title = "Text reply") {
  const session = await hui.createSession({ title });
  await hui.prompt(session, `E2E_REPLY:${Buffer.from(markdown).toString("base64url")}`);
  await hui.open(`/sessions/${session.id}`);
  const transcript = screen.getByTestId("transcript");
  await expect(transcript.getByRole("button", "Copy response")).toBeVisible();
  return transcript;
}

const left = async (target: Locator) => (await target.boundingBox())!.x;

test("Headings, nested lists, strikethrough, quotes and disabled task items render as formatted text, raw HTML stays text and a phone wraps it", { tags: ["RICH-001"], platforms: ["web"] }, async ({ screen, hui }) => {
  const markdown = [
    "# Release notes",
    "## Highlights",
    "- first bullet",
    "  - nested bullet",
    "- last bullet",
    "1. first number",
    "   1. nested number",
    "2. last number",
    "~~removed~~ but kept",
    "> quoted line",
    "- [x] shipped item",
    "- [ ] pending item",
    '<span class="raw-html">raw html stays text</span>',
  ].join("\n\n");
  const transcript = await reply(screen, hui, markdown);

  await expect(transcript.getByRole("heading", "Release notes")).toBeVisible();
  await expect(transcript.getByRole("heading", "Highlights")).toBeVisible();

  const bullet = transcript.getByText("first bullet", { exact: true });
  const nestedBullet = transcript.getByText("nested bullet", { exact: true });
  await expect(nestedBullet).toBeVisible();
  await expect.poll(async () => (await left(nestedBullet)) - (await left(bullet))).toBeGreaterThan(0);
  const numbered = transcript.getByText("first number", { exact: true });
  const nestedNumbered = transcript.getByText("nested number", { exact: true });
  await expect(nestedNumbered).toBeVisible();
  await expect.poll(async () => (await left(nestedNumbered)) - (await left(numbered))).toBeGreaterThan(0);

  // Strikethrough and the quote mark are consumed by the formatting rather than drawn as text.
  await expect(transcript.getByText("removed", { exact: true })).toBeVisible();
  await expect(transcript.getByText("~", { exact: false })).toHaveCount(0);
  await expect(transcript.getByText("quoted line", { exact: true })).toBeVisible();
  await expect(transcript.getByText("> quoted line", { exact: false })).toHaveCount(0);

  const shown = transcript.getByRole("checkbox");
  await expect(shown).toHaveCount(2);
  await expect(shown.first()).toBeChecked();
  await expect(shown.last()).not.toBeChecked();
  for (const item of await shown.all()) {
    await expect(item).toBeDisabled();
    expect((await item.boundingBox())!.x).toBeCloseTo((await shown.first().boundingBox())!.x, 0);
  }

  await expect(transcript.getByText('<span class="raw-html">raw html stays text</span>')).toBeVisible();

  // 390 px wide: the message wraps inside the screen instead of scrolling sideways.
  const phone = await hui.phoneScreen();
  await expect(transcript.getByText("quoted line", { exact: true })).toBeVisible();
  expect(await hui.overflowX()).toBe(0);
  expect((await transcript.boundingBox())!.x + (await transcript.boundingBox())!.width).toBeLessThanOrEqual(phone.width);
});

test("Bare web and email addresses become links with their sentence punctuation left outside, GitHub links carry the mark, code stays literal and a long link wraps on a phone", { tags: ["RICH-002"], platforms: ["web"] }, async ({ screen, hui }) => {
  const long = `https://example.com/${"a-long-path-segment/".repeat(8)}`;
  const transcript = await reply(screen, hui, [
    "Visit https://example.com/docs?q=1, www.example.com/help. Write to test@example.com.",
    "The repository is https://github.com/acme/web and the long one is " + long,
    "The same label without a repository: [acme/web](https://example.com/acme/web)",
    "A code span keeps `https://code.example` literal.",
  ].join("\n\n"));

  await hui.expectLinkTo(transcript, "https://example.com/docs?q=1", "https://example.com/docs?q=1");
  await hui.expectLinkTo(transcript, "www.example.com/help", "http://www.example.com/help");
  await expect(transcript.getByRole("link", "www.example.com/help.")).toHaveCount(0);
  await expect(transcript.getByRole("link", "https://example.com/docs?q=1,")).toHaveCount(0);
  await hui.expectLinkTo(transcript, "test@example.com", "mailto:test@example.com");
  await expect(transcript.getByRole("link", "test@example.com.")).toHaveCount(0);

  // A bare GitHub address shows the owner and repository under the GitHub mark, which the stylesheet paints in the
  // 1.3em it reserves in front of the label (text.css, `a.markdown-github-link::before`): the same label written by
  // hand, without the mark, is exactly that space narrower.
  const marked = transcript.getByText(/^The repository is/u).getByRole("link", "acme/web");
  const plain = transcript.getByText(/^The same label/u).getByRole("link", "acme/web");
  await expect(marked).toHaveAttribute("href", "https://github.com/acme/web");
  const { size } = await hui.look(marked);
  await expect.poll(async () => (await marked.boundingBox())!.width - (await plain.boundingBox())!.width).toBeCloseTo(size * 1.3, 0);

  // A URL inside inline code stays plain text, not a link.
  await expect(transcript.getByText("https://code.example", { exact: true })).toBeVisible();
  await expect(transcript.getByRole("link", "https://code.example")).toHaveCount(0);

  await hui.expectLinkTo(transcript, long, long);
  const phone = await hui.phoneScreen();
  await expect(transcript.getByText("https://code.example", { exact: true })).toBeVisible();
  expect(await hui.overflowX()).toBe(0);
  const link = transcript.getByRole("link", long);
  expect((await link.boundingBox())!.x + (await link.boundingBox())!.width).toBeLessThanOrEqual(phone.width);
});
