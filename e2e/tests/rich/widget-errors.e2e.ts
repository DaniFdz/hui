/** Agent widget failures: what a widget's own runtime raises appears as a notice on its card, and a `show_widget` call
 * HUI refuses stays an ordinary failed tool row that says what to fix (RICH-058, RICH-059). A widget's own document is
 * where its probes live, so its errors are read from the card's notice, the part of the widget HUI itself draws. */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";

/** One `show_widget` call, or several in one answer, as the fixture's provider sends them. */
const call = (calls: { name: string; input: unknown } | { name: string; input: unknown }[]) =>
  `E2E_CALL:${Buffer.from(JSON.stringify(calls)).toString("base64url")}`;

/** Three uncaught errors in a row: the card reports the first, with how many followed it. The first throw sits on the
 * fragment's third line, which is the line the notice must name. */
const FAILS = `<div id="fails">This widget throws.</div>
<script>
setTimeout(function () { throw new Error("first failure"); }, 0);
setTimeout(function () { throw new Error("second failure"); }, 150);
setTimeout(function () { throw new Error("third failure"); }, 300);
</script>`;

/** A promise nobody handles. */
const REJECTS = `<div id="rejects">This widget rejects.</div>
<script>
Promise.reject(new Error("the promise failed"));
</script>`;

/** A load the widget policy refuses; the blocked address is reported as the notice's own text. */
const BLOCKS = `<div id="blocks">This widget loads what it may not.</div>
<img src="https://example.com/tracker.png" alt="tracker">`;

test("A widget's uncaught errors, rejected promise and blocked load show on its card as a notice with the first message, the line counted from the widget's own code and how many followed", { tags: ["RICH-058"], platforms: ["web"] }, async ({ screen, hui }) => {
  const session = await hui.createSession({ title: "Widget errors" });
  await hui.prompt(session, call([
    { name: "show_widget", input: { title: "Fails", widget_code: FAILS } },
    { name: "show_widget", input: { title: "Rejects", widget_code: REJECTS } },
    { name: "show_widget", input: { title: "Blocks", widget_code: BLOCKS } },
  ]));

  await hui.open(`/sessions/${session.id}`);
  const transcript = screen.getByTestId("transcript");
  // A card's frame loads once it nears the screen (`loading="lazy"`), so a phone reads a widget by scrolling to it; the
  // wide layout already draws it where the reply starts.
  const fails = screen.getByLabel("Widget: Fails");
  await hui.scrollTo(transcript, fails);
  await expect(fails.getByText("Interactive widget · sandboxed")).toBeVisible();
  const notice = fails.getByRole("status");
  // The first message, its line counted from the widget's own code rather than HUI's document, and the count after it.
  await expect.poll(() => hui.textOf(notice)).toBe("first failure (line 3, column 32) (+2 more)");
  // Every notice is kept in the notice's own title, so the other two are readable too.
  expect(await notice.getAttribute("title")).toBe("first failure (line 3, column 32)\nsecond failure (line 4, column 32)\nthird failure (line 5, column 32)");

  const rejects = screen.getByLabel("Widget: Rejects");
  await hui.scrollTo(transcript, rejects);
  await expect(rejects.getByText("Interactive widget · sandboxed")).toBeVisible();
  await expect.poll(() => hui.textOf(rejects.getByRole("status"))).toBe("the promise failed");

  const blocks = screen.getByLabel("Widget: Blocks");
  await hui.scrollTo(transcript, blocks);
  await expect(blocks.getByText("Interactive widget · sandboxed")).toBeVisible();
  await expect.poll(() => hui.textOf(blocks.getByRole("status"))).toBe("Blocked by the widget policy (img-src): https://example.com/tracker.png");

  // A widget that raised is still running: the errors are notices, not a stopped card.
  await expect(screen.getByLabel("Widget: Fails").getByRole("button", "Open full screen")).toBeVisible();
});

/** A script that does not parse, with the line and column the message must name. */
const BROKEN = `<div id="broken">Broken</div>
<script>
const first = 1;
const second = ;
</script>`;

test("A show_widget call whose script does not parse, sends a full document, a file path or more than 256 KiB stays a failed tool row naming what to fix, and the corrected call renders as a widget", { tags: ["RICH-059"], platforms: ["web"] }, async ({ screen, hui }) => {
  const session = await hui.createSession({ title: "Rejected widgets" });
  await hui.prompt(session, call([
    { name: "show_widget", input: { title: "Broken", widget_code: BROKEN } },
    { name: "show_widget", input: { title: "Document", widget_code: "<!doctype html>\n<html><body><p>the whole document</p></body></html>" } },
    { name: "show_widget", input: { title: "Path", widget_code: "/tmp/widget.html" } },
    { name: "show_widget", input: { title: "Oversize", widget_code: `<div id="oversize">${"x".repeat(300 * 1024)}</div>` } },
    { name: "show_widget", input: { title: "Fixed", widget_code: "<div id=\"fixed\">The corrected widget.</div>" } },
  ]));

  await hui.open(`/sessions/${session.id}`);
  const transcript = screen.getByTestId("transcript");
  // The corrected call is a live card; none of the refused titles is.
  const fixed = screen.getByLabel("Widget: Fixed");
  await hui.scrollTo(transcript, fixed);
  await expect(fixed.getByText("Interactive widget · sandboxed")).toBeVisible();
  await expect(screen.getByLabel(/^Widget: (Broken|Document|Path|Oversize)$/u)).toHaveCount(0);

  // Each refusal is the model's to fix, and its message names the script, position and offending line where it can.
  // Every refused call keeps a fold of its own; opening one reveals the failed row and its error.
  const folds = transcript.getByText("Used 1 tool");
  await expect(folds).toHaveCount(4);
  for (let index = 0; index < 4; index += 1) await folds.nth(index).tap();
  const rows = transcript.getByRole("button", { name: /^Used show widget/u });
  await expect(rows).toHaveCount(4);
  for (let index = 0; index < 4; index += 1) await rows.nth(index).tap();

  // Each refused call keeps an ordinary failed tool row; opening the row reveals the error it carries.
  const outputs = transcript.getByText(/^<harness>/u);
  await expect(outputs).toHaveCount(4);
  for (let index = 0; index < 4; index += 1) await expect(outputs.nth(index)).toBeVisible();
  expect(await hui.textOf(outputs.nth(0))).toBe("<harness> [error] widget_code has a JavaScript syntax error in inline script 1 at line 4, column 16: Unexpected token ';'. Offending line: const second = ; Fix the script and call show_widget again. </harness>");
  expect(await hui.textOf(outputs.nth(1))).toBe("<harness> [error] widget_code must be an HTML or SVG fragment, not a full document: drop <!doctype>, <html>, <head> and <body>. HUI supplies the document, theme and bridges. </harness>");
  expect(await hui.textOf(outputs.nth(2))).toBe("<harness> [error] widget_code must start with HTML or SVG markup: send the markup itself, not a file path, Markdown fence or prose. </harness>");
  // Code past the limit is refused by the tool's own schema, whose row repeats the arguments it received.
  expect(await hui.textOf(outputs.nth(3))).toMatch(/^<harness> \[error\] Validation failed for tool "show_widget": - widget_code: expected at most 262144 characters/u);
});
