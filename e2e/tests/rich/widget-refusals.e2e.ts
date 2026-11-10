/** A show_widget call HUI refuses stays an ordinary failed tool row that names the script, line and column (or the
 * limit it broke), and the agent's corrected call then renders a working widget (RICH-059). */
import { expect, type Screen } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";

const call = (name: string, input: unknown) => `E2E_CALL:${Buffer.from(JSON.stringify({ name, input })).toString("base64url")}`;

/**
 * One show_widget call of its own session, whose single turn folds into one tool group: opening the group and then the
 * row reads the refusal HUI answered with. A turn of its own keeps the group the only one, so opening it cannot race
 * the next turn's rows.
 */
async function refusal(screen: Screen, hui: Hui, title: string, code: string) {
  const session = await hui.createSession({ title: "Rejected widget" });
  await hui.prompt(session, call("show_widget", { title, widget_code: code }));
  await hui.open(`/sessions/${session.id}`);
  const transcript = screen.getByTestId("transcript");
  await expect(transcript.getByText(/^tool answered: /u)).toBeVisible();
  await transcript.getByText("Used 1 tool").tap();
  const row = transcript.getByRole("button", /^Used show widget/u);
  await expect(row).toBeVisible();
  await row.tap();
  await expect(row).toHaveAccessibleName(/^Used show widget Failed$/u);
  // The refusal is in the row's own output; the turn's reply quotes the same text once more.
  return { transcript, output: (match: RegExp) => transcript.getByText(match).first() };
}

test("A show_widget call whose script does not parse, a full document, a file path and code over 256 KiB are refused as failed tool rows, and the corrected call renders a working widget", { tags: ["RICH-059"], platforms: ["web"] }, async ({ screen, hui }) => {
  // An inline script that does not parse: the error locates the offending line in the widget code itself.
  const script = await refusal(screen, hui, "Broken script", "<p>Sum</p>\n<script>\n  const total = 1;\n  total(1;\n</script>");
  await expect(script.output(/widget_code has a JavaScript syntax error in inline script 1 at line 4, column 9: missing \) after argument list\. Offending line: total\(1; Fix the script and call show_widget again\./u)).toBeVisible();

  const document = await refusal(screen, hui, "Full document", "<!doctype html>\n<html><body><p>A whole document.</p></body></html>");
  await expect(document.output(/widget_code must be an HTML or SVG fragment, not a full document: drop <!doctype>, <html>, <head> and <body>\./u)).toBeVisible();

  const path = await refusal(screen, hui, "File path", "widgets/probe.html");
  await expect(path.output(/widget_code must start with HTML or SVG markup: send the markup itself, not a file path, Markdown fence or prose\./u)).toBeVisible();

  // Over the 256 KiB the tool accepts, the refusal is the call's own schema and names the limit it passed. The row's
  // text is the whole 270 KB call, too long for a text query, so it is read from the row's own transcript text.
  const oversize = await refusal(screen, hui, "Too big", `<div>${"x".repeat(256 * 1024)}</div>`);
  await expect(oversize.transcript.getByText("Output", { exact: true })).toBeVisible();
  await expect.poll(() => hui.textOf(oversize.transcript)).toContain('Validation failed for tool "show_widget": - widget_code: expected at most 262144 characters');

  // The corrected call is a widget of its own, on its own row.
  const session = await hui.createSession({ title: "Corrected widget" });
  await hui.prompt(session, call("show_widget", { title: "Working widget", widget_code: '<div class="card"><h2>Fixed</h2><p>The corrected call renders.</p></div>' }));
  await hui.open(`/sessions/${session.id}`);
  const corrected = screen.getByLabel("Widget: Working widget");
  await expect(corrected).toBeVisible();
  await expect(corrected.getByText("Interactive widget · sandboxed")).toBeVisible();
  await expect.poll(() => hui.textOf(corrected)).toContain("Working widget");
});
