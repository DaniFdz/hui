/** A widget full screen: the card becomes the screen as a modal, keeps its state, focuses Exit full screen and gives the
 * inline card and focus back when it leaves; a widget can also ask for it after a click inside it (RICH-054). */
import { expect } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";

const call = (name: string, input: unknown) => `E2E_CALL:${Buffer.from(JSON.stringify({ name, input })).toString("base64url")}`;

/** A counter, so the card's state lives inside the sandbox where only the card itself can keep it. */
const COUNTER = `<div id="counter"><button type="button" class="primary" id="counter-add">Add one</button><output id="counter-value" aria-live="polite">0</output></div>
<script>
let count = 0;
document.getElementById("counter-add").addEventListener("click", () => {
  count += 1;
  document.getElementById("counter-value").textContent = String(count);
});
</script>`;

/** A widget that asks HUI for the whole screen itself, as one of its controls does: the click is what allows it. */
const ASKS = `<div id="asker"><button type="button" class="primary" id="ask">Take the screen</button><output id="ask-count" aria-live="polite">0</output></div>
<script>
let clicks = 0;
document.getElementById("ask").addEventListener("click", () => {
  clicks += 1;
  document.getElementById("ask-count").textContent = String(clicks);
  window.parent.postMessage({ jsonrpc: "2.0", method: "ui/request-display-mode", params: { mode: "fullscreen" } }, "*");
});
</script>`;

/** The widget's own document inside the card at `index`, whose sandbox page hosts the fragment in a frame of its own. */
const widget = async (hui: Hui, index: number) => (await hui.frame(`iframe.hui-widget-card__frame >> nth=${index}`)).frameLocator("iframe");

test("Open full screen makes the card a modal that keeps its state and focuses Exit full screen, leaving gives the inline card and focus back, and a widget can ask for the screen after a click", { tags: ["RICH-054"], platforms: ["web"] }, async ({ screen, hui }) => {
  const session = await hui.createSession({ title: "Full screen widget" });
  await hui.prompt(session, call("show_widget", { title: "Counter", widget_code: COUNTER }));
  await hui.prompt(session, call("show_widget", { title: "Asker", widget_code: ASKS }));
  await hui.open(`/sessions/${session.id}`);

  const counter = screen.getByLabel("Widget: Counter");
  await expect(counter.getByText("Interactive widget · sandboxed")).toBeVisible();
  const count = await widget(hui, 0);
  await count.getByRole("button", "Add one").tap();
  await count.getByRole("button", "Add one").tap();
  await expect(count.getByRole("status")).toHaveText("2");

  // Open full screen: the same card becomes a modal across the whole screen, with its widget still counting.
  await counter.getByRole("button", "Open full screen").tap();
  const modal = screen.getByRole("dialog", "Widget: Counter");
  await expect(modal).toBeVisible();
  await expect(modal).toHaveAttribute("aria-modal", "true");
  await expect.poll(async () => count.getByRole("status").textContent()).toBe("2");
  const box = (await modal.boundingBox())!;
  // The card is fixed to the viewport; a scrollbar may take a few pixels of it.
  expect(box.x).toBe(0);
  expect(box.y).toBe(0);
  expect(box.width).toBeGreaterThanOrEqual(1420);
  expect(box.height).toBeGreaterThanOrEqual(880);
  await expect(counter.getByRole("button", "Exit full screen")).toBeFocused();

  // Exit full screen: inline again with its count, and the control that opened it has the focus.
  await counter.getByRole("button", "Exit full screen").tap();
  await expect(screen.getByRole("dialog")).toHaveCount(0);
  await expect(counter.getByText("Interactive widget · sandboxed")).toBeVisible();
  await expect(counter.getByRole("button", "Open full screen")).toBeFocused();
  await expect.poll(async () => count.getByRole("status").textContent()).toBe("2");
  await count.getByRole("button", "Add one").tap();
  await expect(count.getByRole("status")).toHaveText("3");

  // A widget can ask for the screen itself, after a click inside it.
  const asker = screen.getByLabel("Widget: Asker");
  await expect(asker.getByText("Interactive widget · sandboxed")).toBeVisible();
  const asks = await widget(hui, 1);
  await asks.getByRole("button", "Take the screen").tap();
  await expect(screen.getByRole("dialog", "Widget: Asker")).toBeVisible();
  await expect.poll(async () => asks.getByRole("status").textContent()).toBe("1");
  await asker.getByRole("button", "Exit full screen").tap();
  await expect(screen.getByRole("dialog")).toHaveCount(0);
  await expect(asker.getByText("Interactive widget · sandboxed")).toBeVisible();
  await expect.poll(async () => asks.getByRole("status").textContent()).toBe("1");
});
