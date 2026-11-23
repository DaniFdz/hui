/** The isolation probe widget: every attempt to leave HUI's widget sandbox is listed as Blocked, the card shows the
 * blocked load as a notice, and HUI and the widget beside it are left as they were (RICH-056). */
import { expect } from "e2e";
import type { Hui } from "../../fixtures/hui.ts";
import { test } from "../../fixtures/widget-probe.ts";

const call = (name: string, input: unknown) => `E2E_CALL:${Buffer.from(JSON.stringify({ name, input })).toString("base64url")}`;

/** A widget of HUI's own, so the probe's failures are measured against one that works. It keeps its count in the
 * sandbox, which nothing outside can read: the probe passing means this count survives too. */
const COUNTER = `<div id="counter"><button type="button" class="primary" id="counter-add">Add one</button><output id="counter-value" aria-live="polite">0</output></div>
<script>
let count = 0;
document.getElementById("counter-add").addEventListener("click", () => {
  count += 1;
  document.getElementById("counter-value").textContent = String(count);
});
</script>`;

/** The widget's own document: the sandbox page hosts the fragment in a frame of its own. */
const widget = async (hui: Hui, frame: string) => (await hui.frame(frame)).frameLocator("iframe");

const ATTEMPTS = [
  "fetch /__hui/settings with x-hui",
  "Read HUI's cookies",
  "Read localStorage",
  "Read HUI's DOM (top.document)",
  "Navigate the top window",
  "Open a popup with window.open",
  "Load a script from example.com",
  "Load an image from example.com",
  "Open a WebSocket to example.com",
  "Run in an opaque origin",
];

test("The isolation probe lists every attempt to leave the sandbox as Blocked, with its origin null, and HUI and the widget beside it stay as they were", { tags: ["RICH-056"], platforms: ["web"] }, async ({ screen, hui, widgetCookies }) => {
  // This is a real, readable cookie on HUI's origin, not an empty parent cookie jar.
  await widgetCookies.expectIntact();
  const session = await hui.createSession({ title: "Sandbox probe" });
  await hui.prompt(session, call("show_widget", { title: "Counter", widget_code: COUNTER }));
  await hui.open(`/sessions/${session.id}`);
  const counter = screen.getByLabel("Widget: Counter");
  await expect(counter.getByText("Interactive widget · sandboxed")).toBeVisible();
  const before = await widget(hui, "iframe.hui-widget-card__frame");
  await before.getByRole("button", "Add one").tap();
  await before.getByRole("button", "Add one").tap();
  await expect(before.getByRole("status")).toHaveText("2");
  const url = await hui.url();

  await hui.prompt(session, "E2E_WIDGET_PROBE");
  const probe = screen.getByLabel("Widget: Sandbox probe");
  await expect(probe.getByText("Interactive widget · sandboxed")).toBeVisible();

  // Every attempt the probe makes is blocked, and none of them is reported as allowed.
  const inside = await widget(hui, "iframe.hui-widget-card__frame >> nth=1");
  const results = inside.getByLabel("Sandbox probe results");
  await expect(results).toBeVisible();
  for (const attempt of ATTEMPTS) {
    const row = results.getByRole("row").filter({ hasText: attempt });
    await expect(row).toBeVisible();
    await expect.poll(() => hui.textOf(row)).toContain("Blocked");
  }
  await expect(results.getByText("ALLOWED")).toHaveCount(0);
  await expect(inside.getByText(`${ATTEMPTS.length}/${ATTEMPTS.length} blocked`)).toBeVisible();
  // The widget runs in an opaque origin, which the probe's own row names.
  await expect(results.getByRole("row").filter({ hasText: "Run in an opaque origin" })).toContainText("origin is null");

  // The blocked requests it tried are the notice on the card: the first in its text, every one in its detail.
  const notice = probe.getByRole("status").filter({ hasText: "Blocked by the widget policy" });
  await expect(notice).toBeVisible();
  await expect(notice).toContainText("Blocked by the widget policy");
  await expect(notice).toHaveAttribute("title", /example\.com/u);

  // HUI itself and the widget beside the probe are untouched: same page, same reply, same count in the sandbox.
  expect(await hui.url()).toBe(url);
  await widgetCookies.expectIntact();
  await expect(screen.getByTestId("transcript").getByText(/^tool answered: /u)).toBeVisible();
  await expect(counter.getByText("Interactive widget · sandboxed")).toBeVisible();
  const after = await widget(hui, "iframe.hui-widget-card__frame >> nth=0");
  await expect(after.getByRole("status")).toHaveText("2");
  await after.getByRole("button", "Add one").tap();
  await expect(after.getByRole("status")).toHaveText("3");
});
