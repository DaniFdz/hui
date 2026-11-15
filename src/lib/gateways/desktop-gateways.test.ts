/** The page's report to HUI's desktop app: the gateways it may show in its window, cleaned to addresses it can open. */
import assert from "node:assert/strict";
import { test } from "vitest";
import { MAX_REPORTED_GATEWAYS, reportedGateways, reportGatewaysToShell, switchGateway } from "./desktop-gateways.ts";

test("an address is a gateway's origin and path, without a trailing slash, query or credentials", () => {
  assert.deepEqual(reportedGateways([
    "http://127.0.0.1:8787/",
    "http://studio.local:8787",
    "https://example.test/hui/",
  ]), ["http://127.0.0.1:8787", "http://studio.local:8787", "https://example.test/hui"]);
  // One address is one entry, and the caller's order is the order the shell tries.
  assert.deepEqual(reportedGateways(["http://b.test", "http://a.test", "http://b.test/"]), ["http://b.test", "http://a.test"]);
});

test("only addresses the shell could open are reported", () => {
  assert.deepEqual(reportedGateways([
    "ftp://studio.local", "javascript:alert(1)", "hui://sessions/a", "http://user:pass@studio.local:8787",
    "http://studio.local:8787/?token=1", "http://studio.local:8787/#top", "not an address", "   ", "",
  ]), []);
  assert.deepEqual(reportedGateways(["  http://studio.local:8787  "]), ["http://studio.local:8787"]);
});

test("a page cannot report an endless list", () => {
  const many = Array.from({ length: MAX_REPORTED_GATEWAYS + 5 }, (_, index) => `http://host${index}.local:8787`);
  const reported = reportedGateways(many);
  assert.equal(reported.length, MAX_REPORTED_GATEWAYS);
  assert.equal(reported[0], "http://host0.local:8787");
});

test("the shell hears the list once, and a browser or a broken bridge changes nothing", () => {
  const calls: (readonly string[])[] = [];
  const record = (links: readonly string[]): void => { calls.push(links); };
  reportGatewaysToShell(["http://studio.local:8787/", "nope"], { reportGateways: record });
  assert.deepEqual(calls, [["http://studio.local:8787"]]);

  reportGatewaysToShell(["nope"], { reportGateways: record });
  assert.equal(calls.length, 1, "nothing worth reporting asks nothing of the shell");

  reportGatewaysToShell(["http://studio.local:8787"], { reportGateways: record });
  reportGatewaysToShell(["http://studio.local:8787"], undefined);
  reportGatewaysToShell(["http://studio.local:8787"], { reportGateways: () => { throw new Error("no shell"); } });
  assert.equal(calls.length, 2, "a shell that cannot hear it does not break the page");
});

test("a switch is the shell's to make when it answers, and this page's otherwise", async () => {
  const navigations: string[] = [];
  const navigate = (url: string): void => { navigations.push(url); };

  // The desktop window takes it, so the page does not navigate out from under it.
  switchGateway("http://studio.local:8787", navigate, { openGateway: async () => true });
  assert.deepEqual(navigations, []);

  // A browser navigates its own tab.
  switchGateway("http://studio.local:8787", navigate, {});
  assert.deepEqual(navigations, ["http://studio.local:8787"]);

  // A shell that refuses, or one that cannot answer, leaves the page to do what a browser does.
  switchGateway("http://loft.local:8787", navigate, { openGateway: async () => false });
  switchGateway("http://loft.local:8787", navigate, { openGateway: async () => { throw new Error("gone"); } });
  switchGateway("http://loft.local:8787", navigate, { openGateway: () => { throw new Error("not a function"); } });
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(navigations, [
    "http://studio.local:8787", "http://loft.local:8787", "http://loft.local:8787", "http://loft.local:8787",
  ]);
});
