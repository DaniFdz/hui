/** Agent widgets: the code's uncaught errors, rejections and blocked loads become one notice on the card, counted
 * from the widget's own lines (RICH-058). */
import { expect, type Screen } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";

const call = (name: string, input: unknown) => `E2E_CALL:${Buffer.from(JSON.stringify({ name, input })).toString("base64url")}`;

async function widget(screen: Screen, hui: Hui, code: string, title: string) {
  const session = await hui.createSession({ title: "Widget" });
  await hui.prompt(session, call("show_widget", { title, widget_code: code }));
  await hui.open(`/sessions/${session.id}`);
  const card = screen.getByLabel(`Widget: ${title}`);
  await expect(card.getByText("Interactive widget · sandboxed")).toBeVisible();
  return card;
}

test("An uncaught error, a rejected promise and a blocked load each appear as a notice on the card, with the first message, its line counted from the widget code, and (+N more)", { tags: ["RICH-058"], platforms: ["web"] }, async ({ screen, hui }) => {
  // Fragment line 3 is the throwing statement: the card counts from the fragment, not from HUI's own document.
  const code = [
    '<div id="probe">Widget probe</div>',
    "<script>",
    '  throw new Error("the widget blew up");',
    "</script>",
    "<script>",
    '  Promise.reject(new Error("the widget promise broke"));',
    "</script>",
    '<img src="https://example.com/blocked.png" alt="">',
  ].join("\n");
  const card = await widget(screen, hui, code, "Broken widget");

  const notice = card.getByRole("status").filter({ hasText: "the widget blew up" });
  await expect(notice).toBeVisible();
  await expect.poll(() => hui.textOf(notice)).toMatch(/^the widget blew up \(line 3, column \d+\) \(\+2 more\)$/u);
  await expect(notice).toHaveAttribute("title", /the widget blew up \(line 3, column \d+\)[\s\S]*the widget promise broke[\s\S]*Blocked by the widget policy/u);
});
