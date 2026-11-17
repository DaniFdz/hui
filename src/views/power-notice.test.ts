/**
 * The "This Mac won't sleep with the lid closed" notice's two buttons and what it shows. Whether the lid switch is
 * actually holding the Mac awake is `settings-gateway.test.ts`'s predicate, asserted beside the Power section it drives;
 * where the chat places the notice is `home.test.ts`'s.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import type { PowerStatus } from "../api/schema/power.ts";
import { renderPowerNotice } from "./power-notice.ts";

/** A Lit template's markup, with bound values written out. */
function markup(value: unknown): string {
  if (Array.isArray(value)) return value.map(markup).join("");
  if (value && typeof value === "object" && "strings" in value && "values" in value) {
    const template = value as { strings: readonly string[]; values: unknown[] };
    return template.strings.map((part, i) => part + markup(template.values[i])).join("");
  }
  return ["string", "number", "boolean"].includes(typeof value) ? String(value) : "";
}

const power: PowerStatus = {
  keepAwake: { state: "active", detail: "" },
  lidAwake: { state: "error", detail: "Administrator approval was cancelled." },
  lidOn: false,
};
const held = (state: PowerStatus["lidAwake"]["state"], lidOn: boolean): PowerStatus => ({
  ...power,
  lidAwake: { state, detail: "" },
  lidOn,
});
const noop = () => {};

test("the sleep notice says the Mac stays awake and offers turning the lid switch off or dismissing it", () => {
  const html = markup(renderPowerNotice({ power: held("active", true), dismissed: false, inert: false, onTurnOff: noop, onDismiss: noop }));
  assert.match(html, /<aside class="hui-update-notice" aria-label="Sleep prevention" \?inert=false>/u);
  assert.match(html, /This Mac won't sleep with the lid closed\./u);
  assert.match(html, /<button class="btn hui-update-notice__review" @click=[^>]*>Turn off<\/button>/u);
  assert.match(html, /<button class="hui-update-notice__dismiss" aria-label="Dismiss sleep prevention notification"\s+title="Dismiss until it turns on again"/u);
});

test("the sleep notice stays away while the lid switch is off or pending, before the power state is known, and once dismissed", () => {
  const render = (overrides: Partial<Parameters<typeof renderPowerNotice>[0]>) =>
    markup(renderPowerNotice({ power: held("active", true), dismissed: false, inert: false, onTurnOff: noop, onDismiss: noop, ...overrides }));
  assert.equal(render({ power: held("active", false) }), "", "a lid switch that is off has nothing to report");
  assert.equal(render({ power: held("pending", true) }), "", "approval still pending is not yet holding the Mac awake");
  assert.equal(render({ power: null }), "", "a gateway that is not macOS reports no power state");
  assert.equal(render({ power: undefined }), "", "nothing is known before the gateway answers");
  assert.equal(render({ dismissed: true }), "", "the operator put it away");
});
