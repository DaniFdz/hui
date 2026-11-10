/** A widget through a theme change: HUI's switch re-themes it in place, with HUI's colors on a transparent background,
 * without reloading its document or losing the state kept inside (RICH-053). */
import { expect } from "e2e";
import { test, type Hui } from "../../fixtures/hui.ts";

const call = (name: string, input: unknown) => `E2E_CALL:${Buffer.from(JSON.stringify({ name, input })).toString("base64url")}`;

/**
 * The widget reports what it was handed and what it renders, because HUI's page cannot read into its sandbox: its
 * theme mode, the background it paints from HUI's `surface` token, the background behind it and the origin of the document it runs
 * in. A document that reloaded would report a new `timeOrigin`; one that kept its state reports the same count.
 */
const THEMED = `<div id="themed">
<button type="button" class="primary" id="add">Add one</button><output id="count" aria-label="Probe count" aria-live="polite">0</output>
<output id="mode" aria-label="Probe mode"></output>
<output id="swatch" aria-label="Probe background" style="background:var(--surface)"></output>
<output id="page" aria-label="Probe behind"></output>
<output id="origin" aria-label="Probe origin"></output>
</div>
<script>
const report = () => {
  document.getElementById("mode").textContent = getComputedStyle(document.documentElement).colorScheme || "";
  document.getElementById("swatch").textContent = getComputedStyle(document.getElementById("swatch")).backgroundColor;
  document.getElementById("page").textContent = getComputedStyle(document.body).backgroundColor;
  document.getElementById("origin").textContent = String(Math.round(performance.timeOrigin));
};
let count = 0;
document.getElementById("add").addEventListener("click", () => {
  count += 1;
  document.getElementById("count").textContent = String(count);
});
window.addEventListener("message", report);
report();
</script>`;

const widget = async (hui: Hui) => (await hui.frame("iframe.hui-widget-card__frame")).frameLocator("iframe");

/** `rgb(r, g, b)` as numbers, the form a computed colour arrives in. */
const rgb = (value: string): number[] => {
  const channels = /rgba?\(([\d.]+), ([\d.]+), ([\d.]+)/u.exec(value);
  if (!channels) throw new Error(`${value} is not an rgb colour`);
  return channels.slice(1, 4).map(Number);
};

const read = async (hui: Hui, label: string) => {
  const inside = await widget(hui);
  return (await inside.getByLabel(label).textContent()) ?? "";
};

test("A light-to-dark switch re-themes the widget in place with HUI's colors on a transparent background, without reloading it or losing its state", { tags: ["RICH-053"], platforms: ["web"] }, async ({ screen, hui }) => {
  const session = await hui.createSession({ title: "Themed widget" });
  await hui.prompt(session, call("show_widget", { title: "Themed", widget_code: THEMED }));
  await hui.open(`/sessions/${session.id}`);
  const card = screen.getByLabel("Widget: Themed");
  await expect(card.getByText("Interactive widget · sandboxed")).toBeVisible();
  await expect.poll(() => hui.appearance()).toBe("light");

  const inside = await widget(hui);
  await inside.getByRole("button", "Add one").tap();
  await inside.getByRole("button", "Add one").tap();
  await expect(inside.getByLabel("Probe count")).toHaveText("2");
  const light = { mode: await read(hui, "Probe mode"), swatch: await read(hui, "Probe background"), page: await read(hui, "Probe behind"), origin: await read(hui, "Probe origin") };
  expect(light.mode).toBe("light");
  // The widget paints HUI's background token, and nothing of its own behind it.
  expect(rgb(light.swatch).every((channel) => channel > 200)).toBe(true);
  expect(light.page).toBe("rgba(0, 0, 0, 0)");

  // The device turns dark, which is the switch a reader makes in Settings → Appearance.
  await hui.deviceAppearance("dark");
  await expect.poll(() => hui.appearance()).toBe("dark");
  await expect(inside.getByLabel("Probe mode")).toHaveText("dark");
  const dark = { swatch: await read(hui, "Probe background"), page: await read(hui, "Probe behind") };
  expect(rgb(dark.swatch).every((channel) => channel < 80)).toBe(true);
  expect(dark.swatch).not.toBe(light.swatch);
  // Same document, same state: the widget was re-themed in place, not reloaded.
  expect(await read(hui, "Probe origin")).toBe(light.origin);
  expect(dark.page).toBe("rgba(0, 0, 0, 0)");
  await expect(inside.getByLabel("Probe count")).toHaveText("2");
  await inside.getByRole("button", "Add one").tap();
  await expect(inside.getByLabel("Probe count")).toHaveText("3");

  // And back again, still in the same document.
  await hui.deviceAppearance("light");
  await expect.poll(() => hui.appearance()).toBe("light");
  await expect(inside.getByLabel("Probe mode")).toHaveText("light");
  expect(await read(hui, "Probe background")).toBe(light.swatch);
  expect(await read(hui, "Probe origin")).toBe(light.origin);
  await expect(inside.getByLabel("Probe count")).toHaveText("3");
});
