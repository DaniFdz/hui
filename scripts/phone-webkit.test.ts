/** Pins mobile WebKit's context isolation without replacing the service worker in offline journeys. */
import assert from "node:assert/strict";
import { test } from "vitest";
import { phoneContextOptions, webkitServiceWorkers } from "../e2e/fixtures/phone-webkit.ts";

test("ordinary phone contexts isolate routes, offline contexts run the real worker, and the next test resets it", () => {
  const engine = { viewport: { width: 390, height: 844 }, userAgent: "phone", serviceWorkers: "block" };
  webkitServiceWorkers(false);
  assert.deepEqual(phoneContextOptions(engine), { hasTouch: true, isMobile: true, ...engine, serviceWorkers: "block" });
  try {
    webkitServiceWorkers(true);
    assert.deepEqual(phoneContextOptions(engine), { hasTouch: true, isMobile: true, ...engine, serviceWorkers: "allow" });
  } finally {
    webkitServiceWorkers(false);
  }
  assert.equal(phoneContextOptions().serviceWorkers, "block");
});
