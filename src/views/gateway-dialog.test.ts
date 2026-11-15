/** The Add/Edit gateway dialog: its two modes, the fixed address of the gateway serving the page, and its refusals. */
import assert from "node:assert/strict";
import { test } from "vitest";
import type { GatewayDialogState } from "../lib/gateways/gateway-list.ts";
import { renderGatewayDialog } from "./gateway-dialog.ts";

function text(value: unknown): string {
  if (Array.isArray(value)) return value.map(text).join("");
  if (value && typeof value === "object" && "strings" in value && "values" in value) {
    const template = value as { strings: readonly string[]; values: unknown[] };
    return template.strings.map((part, i) => part + text(template.values[i])).join("");
  }
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

const dialog = (overrides: Partial<GatewayDialogState> = {}): GatewayDialogState => ({
  mode: "add", originalUrl: "", name: "", address: "", addressFixed: false, busy: false, error: "", ...overrides,
});
const render = (state: GatewayDialogState) => text(renderGatewayDialog({
  dialog: state, onName: () => undefined, onAddress: () => undefined, onClose: () => undefined, onSubmit: () => undefined,
}));

test("adding asks for a name and an address and names the handshake", () => {
  const result = render(dialog({ name: "Loft", address: "loft.local:8787" }));
  assert.match(result, /id="gateway-dialog-title">Add gateway</u);
  assert.match(result, /Pick a name and an address\. HUI asks the address to identify itself before adding it\./u);
  assert.match(result, /<span>Name<\/span>/u);
  assert.match(result, /<span>Address<\/span>/u);
  assert.match(result, /placeholder=Uses the name the gateway reports/u);
  assert.match(result, /\.value=Loft/u);
  assert.match(result, /\.value=loft\.local:8787/u);
  assert.match(result, />Add gateway\s*</u);
  assert.match(result, />Cancel</u);
});

test("editing a saved gateway asks for both, and the gateway serving this page fixes its address", () => {
  const saved = render(dialog({ mode: "edit", originalUrl: "http://loft.local:8787", name: "Loft", address: "http://loft.local:8787" }));
  assert.match(saved, /id="gateway-dialog-title">Edit gateway</u);
  assert.match(saved, /Change the name this device shows for it, and the address it opens\./u);
  assert.match(saved, /\.value=http:\/\/loft\.local:8787/u);
  assert.match(saved, /Save changes/u);

  const current = render(dialog({ mode: "edit", originalUrl: "http://127.0.0.1:8787", name: "Studio Mac", address: "http://127.0.0.1:8787", addressFixed: true }));
  assert.match(current, /This gateway serves this page, so its address is fixed\. Its name is what every client that connects sees\./u);
  assert.match(current, /placeholder=Uses this machine's hostname/u);
  assert.match(current, /Its address is where this page came from: <code>http:\/\/127\.0\.0\.1:8787<\/code>\./u);
});

test("a refusal and a running probe stay in the dialog", () => {
  const refused = render(dialog({ address: "http://nope.local:8787", error: "This address doesn't answer as a HUI gateway." }));
  assert.match(refused, /role="alert">This address doesn't answer as a HUI gateway\./u);
  assert.match(refused, /\.value=http:\/\/nope\.local:8787/u, "the address stays to correct");

  const busy = render(dialog({ mode: "edit", address: "http://loft.local:8787", busy: true }));
  assert.match(busy, /aria-busy=true/u);
  assert.match(busy, /Saving…/u);
  assert.match(busy, /\?disabled= /u, "the fields and the actions wait");});
