/** The boot recovery card's two probes: the same-origin health read and another address's identity handshake. */
import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";
import { probeBootGateway, probeBootHealth } from "./boot-health.ts";

const requests: { url: string; init?: RequestInit }[] = [];

function stub(respond: (url: string, init?: RequestInit) => Response | Promise<Response>): void {
  requests.length = 0;
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ url: String(input), init });
    return Promise.resolve().then(() => respond(String(input), init));
  });
}

afterEach(() => { vi.unstubAllGlobals(); });

test("the health probe is a guarded same-origin read with its own deadline", async () => {
  stub(() => new Response("{}", { status: 200 }));
  assert.equal(await probeBootHealth(), true);
  assert.equal(requests[0]?.url, "/__hui/health");
  assert.deepEqual(requests[0]?.init?.headers, { "x-hui": "1" });
  assert.equal(requests[0]?.init?.cache, "no-store");
  assert.ok(requests[0]?.init?.signal instanceof AbortSignal, "a gateway that never answers cannot hold the boot screen");
});

test("a health route that refuses or cannot be reached reads as unreachable", async () => {
  stub(() => new Response("{}", { status: 503 }));
  assert.equal(await probeBootHealth(), false);

  stub(() => new Response("{}", { status: 404 }));
  assert.equal(await probeBootHealth(), false);

  stub(() => Promise.reject(new TypeError("Failed to fetch")));
  assert.equal(await probeBootHealth(), false);
  assert.equal(requests[0]?.init?.cache, "no-store");
});

test("another address answers as HUI only with the identity handshake, asked cross-origin", async () => {
  stub(() => new Response(JSON.stringify({ currentVersion: "1.2.3", job: null, name: "Loft" }), { status: 200 }));
  assert.deepEqual(await probeBootGateway("http://loft.test:8787"), { ok: true, name: "Loft" });
  assert.equal(requests[0]?.url, "http://loft.test:8787/__hui/update");
  assert.equal(requests[0]?.init?.mode, "cors", "the one route a gateway answers cross-origin");
  assert.deepEqual(requests[0]?.init?.headers, { "x-hui": "1" });
  assert.ok(requests[0]?.init?.signal instanceof AbortSignal);

  // A development checkout answers `currentVersion: null`, which is still HUI.
  stub(() => new Response(JSON.stringify({ currentVersion: null, job: null }), { status: 200 }));
  assert.deepEqual(await probeBootGateway("http://loft.test:8787"), { ok: true, name: "" });

  // Another page, a refusal, and an address that never answers are all the same refusal to the person asking.
  stub(() => new Response(JSON.stringify({ ok: true }), { status: 200 }));
  assert.deepEqual(await probeBootGateway("http://loft.test:8787"), { ok: false });
  stub(() => new Response("{}", { status: 403 }));
  assert.deepEqual(await probeBootGateway("http://loft.test:8787"), { ok: false });
  stub(() => Promise.reject(new TypeError("Failed to fetch")));
  assert.deepEqual(await probeBootGateway("http://loft.test:8787"), { ok: false });
});
