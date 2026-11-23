/** A reply's math: `$…$` renders inline and a `$$` block on its own lines renders display math, a malformed formula
 * shows KaTeX's reason in its own place while the rest of the reply still renders, and a lone currency dollar stays
 * ordinary text (RICH-012). */
import { expect, type Screen } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";

async function reply(screen: Screen, hui: Hui, markdown: string) {
  const session = await hui.createSession({ title: "Math reply" });
  await hui.prompt(session, `E2E_REPLY:${Buffer.from(markdown).toString("base64url")}`);
  await hui.open(`/sessions/${session.id}`);
  const transcript = screen.getByTestId("transcript");
  await expect(transcript.getByRole("button", "Copy response")).toBeVisible();
  return transcript;
}

// KaTeX draws a formula in two parts: a MathML copy a screen reader reads, and the drawn glyphs. Neither of them
// holds the `$` markers or the TeX source the reply wrote, so the glyphs are what proves the formula was rendered:
// `x^2 + y^2 = z^2` is drawn as x, a raised 2, `+`, and so on, which reads x 2 +y 2 =z 2.
test("$…$ renders inline math and a $$ block display math, a malformed formula shows Math could not be rendered in its place, and a currency dollar stays text", { tags: ["RICH-012"], platforms: ["web"] }, async ({ screen, hui }) => {
  const transcript = await reply(screen, hui, [
    "Inline: $x^2 + y^2 = z^2$ stays on the line.",
    "$$\na^2 + b^2 = c^2\n$$",
    "Malformed: $\\frac{1}{$ stays put.",
    "Prices: $5 and $10 stay text.",
  ].join("\n\n"));

  await expect.poll(() => hui.textOf(transcript)).toMatch(/x\s*2\s*\+\s*y\s*2\s*=\s*z\s*2/u);
  await expect.poll(() => hui.textOf(transcript)).toMatch(/a\s*2\s*\+\s*b\s*2\s*=\s*c\s*2/u);
  await expect(transcript.getByText("Inline:", { exact: false })).toBeVisible();
  await expect(transcript.getByText("$$", { exact: false })).toHaveCount(0);

  // Only the malformed formula is replaced, by KaTeX's own reason.
  await expect(transcript.getByText(/^Math could not be rendered: KaTeX parse error: /u)).toBeVisible();
  await expect(transcript.getByText("Malformed:", { exact: false })).toBeVisible();
  await expect(transcript.getByText("stays put.", { exact: false })).toBeVisible();
  await expect.poll(() => hui.textOf(transcript)).toMatch(/x\s*2\s*\+\s*y\s*2\s*=\s*z\s*2/u);

  // A dollar that opens no formula is an ordinary character.
  await expect(transcript.getByText("Prices: $5 and $10 stay text.")).toBeVisible();
});
