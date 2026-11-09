import assert from "node:assert/strict";
import { test } from "vitest";

import { EXTENSION_EMPTY_NOTE, EXTENSION_STATE_LABEL, EXTENSION_TRUST_NOTE, extensionRoutesSummary, extensionToggleLabel } from "./presentation.ts";

test("an extension's routes read as a count and their methods", () => {
  assert.equal(extensionRoutesSummary([]), "No routes");
  assert.equal(extensionRoutesSummary([{ method: "GET", path: "hello", description: "" }]), "1 route · GET");
  assert.equal(extensionRoutesSummary([
    { method: "GET", path: "hello", description: "" },
    { method: "GET", path: "again", description: "" },
    { method: "POST", path: "echo", description: "" },
  ]), "3 routes · GET, POST");
});

test("state labels, the toggle label and the copy are shared", () => {
  assert.deepEqual(EXTENSION_STATE_LABEL, { loaded: "Loaded", disabled: "Disabled", failed: "Failed", missing: "Missing" });
  assert.equal(extensionToggleLabel({ name: "Hello" }), "Enable Hello");
  assert.match(EXTENSION_TRUST_NOTE, /run inside the gateway/u);
  assert.match(EXTENSION_EMPTY_NOTE, /~\/\.config\/hui\/extensions/u);
});
