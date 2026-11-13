/** Escape leaves a full-screen widget: pressed while HUI's own Exit control holds the focus, and pressed inside the
 * widget's own document while the widget has the focus, the card comes back inline with the state it kept and with the
 * focus back on the control that took it full screen (RICH-055). */
import { expect } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";

const call = (name: string, input: unknown) => `E2E_CALL:${Buffer.from(JSON.stringify({ name, input })).toString("base64url")}`;

/** A counter, so "its state kept" is a number only the sandbox holds. */
const COUNTER = `<div id="counter"><button type="button" class="primary" id="counter-add">Add one</button><output id="counter-value" aria-live="polite">0</output></div>
<script>
let count = 0;
document.getElementById("counter-add").addEventListener("click", () => {
  count += 1;
  document.getElementById("counter-value").textContent = String(count);
});
</script>`;

/** The widget's own document inside the card, whose sandbox page hosts the fragment in a frame of its own. */
const widget = async (hui: Hui) => (await hui.frame("iframe.hui-widget-card__frame")).frameLocator("iframe");

test("Escape, pressed in HUI and pressed inside the widget itself, leaves a full-screen widget inline with its state kept and the focus back where it was", { tags: ["RICH-055"], platforms: ["web"] }, async ({ screen, hui }) => {
  const session = await hui.createSession({ title: "Escape full screen" });
  await hui.prompt(session, call("show_widget", { title: "Counter", widget_code: COUNTER }));
  await hui.open(`/sessions/${session.id}`);

  const card = screen.getByLabel("Widget: Counter");
  await expect(card.getByText("Interactive widget · sandboxed")).toBeVisible();
  const inside = await widget(hui);
  await inside.getByRole("button", "Add one").tap();
  await expect(inside.getByRole("status")).toHaveText("1");

  // Escape in HUI: Exit full screen holds the focus, and the card's own listener takes the key.
  await card.getByRole("button", "Open full screen").tap();
  await expect(screen.getByRole("dialog", "Widget: Counter")).toBeVisible();
  await expect(card.getByRole("button", "Exit full screen")).toBeFocused();
  await hui.keyboard.down("Escape");
  await hui.keyboard.up("Escape");
  await expect(screen.getByRole("dialog")).toHaveCount(0);
  await expect(card.getByText("Interactive widget · sandboxed")).toBeVisible();
  await expect(card.getByRole("button", "Open full screen")).toBeFocused();
  await expect.poll(async () => inside.getByRole("status").textContent()).toBe("1");

  // Escape pressed inside the focused widget: its document asks HUI for the inline card itself.
  await card.getByRole("button", "Open full screen").tap();
  await expect(screen.getByRole("dialog", "Widget: Counter")).toBeVisible();
  await inside.getByRole("button", "Add one").tap();
  await expect(inside.getByRole("status")).toHaveText("2");
  await inside.getByRole("button", "Add one").press("Escape");
  await expect(screen.getByRole("dialog")).toHaveCount(0);
  await expect(card.getByText("Interactive widget · sandboxed")).toBeVisible();
  await expect(card.getByRole("button", "Open full screen")).toBeFocused();
  await expect.poll(async () => inside.getByRole("status").textContent()).toBe("2");
  await inside.getByRole("button", "Add one").tap();
  await expect(inside.getByRole("status")).toHaveText("3");
});
