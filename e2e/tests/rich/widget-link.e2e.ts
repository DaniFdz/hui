/** A link a widget draws opens in a new browser tab with no opener and no referrer while HUI stays in place, and a
 * request the widget makes for itself — with no click behind it, or for something that is not a web page — is refused
 * (RICH-057). The widget runs in an opaque-origin frame behind the sandbox proxy, so it asks the chat to open the link:
 * the fixture records the address the page asked for and the features it asked with (`hui.tab()`), which is what says
 * no opener and no referrer. A request with no click behind it is dropped by the sandbox before the chat sees it, so
 * that refusal shows as the widget never being answered, and the chat asking no tab for it. */
import { expect } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";

const call = (name: string, input: unknown) => `E2E_CALL:${Buffer.from(JSON.stringify({ name, input })).toString("base64url")}`;

/** A widget with a link, a control that asks for a scheme that is not a web page, and a request for a page it makes on
 * load with no click behind it. Its outputs show what it posted and what the chat answered each request. */
const WIDGET = `<div class="row">
  <a id="link" href="https://example.com/widget-link">Open example</a>
  <button type="button" id="scheme">Ask for another scheme</button>
  <output id="posted" aria-label="Probe posted">no</output>
  <output id="answered" aria-label="Probe answered on load">waiting</output>
  <output id="scheme-out" aria-label="Probe scheme">waiting</output>
</div>
<script>
const chat = window.parent;
const ask = (id, url) => chat.postMessage({ jsonrpc: "2.0", id, method: "ui/open-link", params: { url } }, "*");
window.addEventListener("message", (event) => {
  if (event.source !== chat) return;
  const data = event.data;
  if (!data || data.jsonrpc !== "2.0" || !data.id) return;
  const output = data.id === "load" ? document.getElementById("answered") : data.id === "scheme" ? document.getElementById("scheme-out") : undefined;
  if (output) output.textContent = data.error ? data.error.message : "opened";
});
document.getElementById("scheme").addEventListener("click", () => ask("scheme", "javascript:alert(1)"));
ask("load", "https://example.com/no-click");
document.getElementById("posted").textContent = "yes";
</script>`;

const widget = async (hui: Hui) => (await hui.frame("iframe.hui-widget-card__frame")).frameLocator("iframe");

test("a link inside a widget opens in a new tab with no opener and no referrer, and a request without a click or for another scheme is refused", { tags: ["RICH-057"], platforms: ["web"] }, async ({ screen, hui }) => {
  const session = await hui.createSession({ title: "Open a widget link" });
  await hui.prompt(session, call("show_widget", { title: "Link", widget_code: WIDGET }));
  await hui.open(`/sessions/${session.id}`);
  const card = screen.getByLabel("Widget: Link");
  await expect(card.getByText("Interactive widget · sandboxed")).toBeVisible();

  const inside = await widget(hui);
  // The widget asked for a web page as soon as it loaded, and the chat never answered that request or asked for a tab:
  // with no click behind it, the sandbox drops it before it reaches HUI.
  await expect(inside.getByLabel("Probe posted")).toHaveText("yes");
  await expect(inside.getByLabel("Probe answered on load")).toHaveText("waiting");
  expect(await hui.tabs()).toEqual([]);

  // A click on the link the widget draws asks the chat for the page, which opens it in a tab of its own.
  const here = await hui.url();
  await inside.getByRole("link", "Open example").tap();
  const tab = await hui.tab();
  expect(tab?.via).toBe("window.open");
  expect(tab?.url).toBe("https://example.com/widget-link");
  expect(tab?.noopener).toBe(true);
  expect(tab?.noreferrer).toBe(true);
  // HUI stays on the session while the page opens elsewhere.
  expect(await hui.url()).toBe(here);
  expect(await hui.tabs()).toHaveLength(1);

  // Asking for a scheme that is not a web page is refused with what the chat says, and asks for no tab.
  await inside.getByRole("button", "Ask for another scheme").tap();
  await expect(inside.getByLabel("Probe scheme")).toHaveText("Only http and https links can be opened.");
  expect(await hui.tabs()).toHaveLength(1);
  expect((await hui.tab())?.url).toBe("https://example.com/widget-link");
  expect(await hui.url()).toBe(here);
  await expect(card.getByText("Interactive widget · sandboxed")).toBeVisible();
  await expect(screen.getByTestId("transcript").getByText(/^tool answered: /u)).toBeVisible();
});
