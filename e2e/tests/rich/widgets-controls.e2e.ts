/** A widget's own controls: a click toggles its state, color and shape, pointer movement over it moves its gaze, and the
 * widget's document raises no error while HUI's card shows no notice (RICH-052). HUI's own console is not readable
 * through this fixture, so that half of "no errors on the page" is proven only where the card would show it. */
import { expect } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";

const call = (name: string, input: unknown) => `E2E_CALL:${Buffer.from(JSON.stringify({ name, input })).toString("base64url")}`;

/**
 * A face the way a widget draws one: one control toggles its mood, which changes its shape and its color, and the
 * pointer moving over it moves its gaze. It also counts what its own document raises, which is the half of "no errors
 * on the page" a sandbox can report on itself.
 */
const FACE = `<div id="face" data-mood="happy">
<div class="row">
  <button type="button" class="primary" id="mood">Change mood</button>
  <output id="mood-out" data-testid="mood">happy</output>
  <output id="shape" data-testid="shape">round</output>
  <output id="colour" data-testid="colour"></output>
</div>
<div class="row">
  <div id="pad-left" data-testid="pad-left" style="flex:1">left half</div>
  <div id="pad-right" data-testid="pad-right" style="flex:1">right half</div>
</div>
<div class="row">
  <output id="gaze" data-testid="gaze">centre</output>
  <output id="errors" data-testid="errors">none</output>
</div>
</div>
<script>
const face = document.getElementById("face");
const raised = [];
const showErrors = () => {
  document.getElementById("errors").textContent = raised.length ? raised.join(", ") : "none";
};
window.addEventListener("error", () => { raised.push("error"); showErrors(); });
window.addEventListener("unhandledrejection", () => { raised.push("rejection"); showErrors(); });
const paint = () => {
  document.getElementById("mood-out").textContent = face.dataset.mood;
  document.getElementById("shape").textContent = face.dataset.mood === "happy" ? "round" : "square";
  face.style.color = face.dataset.mood === "happy" ? "var(--ok)" : "var(--danger)";
  document.getElementById("colour").textContent = getComputedStyle(face).color;
};
document.getElementById("mood").addEventListener("click", () => {
  face.dataset.mood = face.dataset.mood === "happy" ? "sad" : "happy";
  paint();
});
face.addEventListener("pointermove", (event) => {
  const box = face.getBoundingClientRect();
  const gaze = event.clientX - box.left < box.width / 2 ? "left" : "right";
  face.dataset.gaze = gaze;
  document.getElementById("gaze").textContent = gaze;
});
paint();
showErrors();
</script>`;

const widget = async (hui: Hui) => (await hui.frame("iframe.hui-widget-card__frame")).frameLocator("iframe");

test("A widget's own controls toggle its state, shape and color, its gaze follows pointer movement over it, and its document raises no error", { tags: ["RICH-052"], platforms: ["web"] }, async ({ screen, hui }) => {
  const session = await hui.createSession({ title: "Live widget" });
  await hui.prompt(session, call("show_widget", { title: "Face", widget_code: FACE }));
  await hui.open(`/sessions/${session.id}`);
  const card = screen.getByLabel("Widget: Face");
  await expect(card.getByText("Interactive widget · sandboxed")).toBeVisible();

  const face = await widget(hui);
  const read = async (field: string) => (await face.getByTestId(field).textContent()) ?? "";
  await expect(face.getByTestId("mood")).toHaveText("happy");
  await expect(face.getByTestId("shape")).toHaveText("round");
  const happy = await read("colour");

  // A click on the widget's own control changes its state, its shape and its color.
  await face.getByRole("button", "Change mood").tap();
  await expect(face.getByTestId("mood")).toHaveText("sad");
  await expect(face.getByTestId("shape")).toHaveText("square");
  await expect.poll(() => read("colour")).not.toBe(happy);
  const sad = await read("colour");
  await face.getByRole("button", "Change mood").tap();
  await expect(face.getByTestId("mood")).toHaveText("happy");
  await expect(face.getByTestId("shape")).toHaveText("round");
  await expect.poll(() => read("colour")).toBe(happy);
  expect(sad).not.toBe(happy);

  // Pointer movement over it moves its gaze, the widget's own code deciding where to look, in both directions.
  await hui.peek(face.getByTestId("pad-right"));
  await expect(face.getByTestId("gaze")).toHaveText("right");
  await hui.peek(face.getByTestId("pad-left"));
  await expect(face.getByTestId("gaze")).toHaveText("left");
  await hui.peek(face.getByTestId("pad-right"));
  await expect(face.getByTestId("gaze")).toHaveText("right");

  // Nothing raised in the widget's document, and the card shows no error notice.
  await expect(face.getByTestId("errors")).toHaveText("none");
  await expect(card.getByRole("status")).toHaveCount(0);
  await expect(card.getByText("Interactive widget · sandboxed")).toBeVisible();
  await expect(screen.getByTestId("transcript").getByText(/^tool answered: /u)).toBeVisible();
});
