/** The boot recovery card's rules: when it appears, what it says, which gateways it offers and what Add refuses. */
import assert from "node:assert/strict";
import { test } from "vitest";
import {
  GATEWAY_ALREADY_SAVED,
  GATEWAY_HANDOFF_PARAM,
  GATEWAY_IS_CURRENT,
  GATEWAY_MIXED_CONTENT,
  GATEWAY_NOT_AN_ADDRESS,
  GATEWAY_REFUSED,
  gatewayHandoff,
  loopbackRefusal,
  readGatewayHandoff,
  type GatewayEntry,
} from "./gateway-list.ts";
import {
  RECOVERY_DEADLINE_MS,
  RECOVERY_PROBE_AT_MS,
  RECOVERY_PROBE_DEADLINE_MS,
  RECOVERY_PROBE_TIMEOUT_MS,
  recoveryAddError,
  recoveryGateways,
  recoveryHeadline,
  recoveryRefusal,
  recoveryStage,
  recoverySwitchAddress,
} from "./recovery.ts";

const CURRENT = "http://127.0.0.1:8787";

const entry = (url: string, name: string, lastSeen: number): GatewayEntry => ({ url, name, lastSeen });

test("the boot screen waits while a slow link may still deliver the app, and recovers when the gateway does not answer", () => {
  assert.equal(RECOVERY_PROBE_AT_MS, 6_000);
  assert.equal(RECOVERY_DEADLINE_MS, 10_000);
  assert.equal(RECOVERY_PROBE_TIMEOUT_MS, 4_000);
  assert.equal(RECOVERY_PROBE_DEADLINE_MS, 10_000);

  assert.equal(recoveryStage(5_999, "unreachable"), "waiting", "the probe only starts at six seconds");
  assert.equal(recoveryStage(9_999, "pending"), "waiting", "a probe still pending has not failed yet");
  assert.equal(recoveryStage(10_000, "pending"), "recovery", "ten seconds is the page's own deadline");
  assert.equal(recoveryStage(6_000, "unreachable"), "recovery", "a gateway that answers nothing is not slow");
  assert.equal(recoveryStage(6_000, "reachable"), "waiting", "the app may still be downloading");
});

test("the card's heading tells a gateway that is down from a download that is slow", () => {
  assert.equal(recoveryHeadline("reachable"), "HUI is taking longer than usual to start.");
  assert.equal(recoveryHeadline("pending"), "Can't reach this gateway.");
  assert.equal(recoveryHeadline("unreachable"), "Can't reach this gateway.");
});

test("the card offers every other gateway this device knows, the one it left first, without the one serving it", () => {
  const saved = [entry("http://loft.test", "Loft", 300), entry("http://attic.test", "", 100)];
  // What the switch that opened this page carried: the gateway it left, a row this device saved since, and the
  // address the page is on, which is never offered back to itself.
  const carried = readGatewayHandoff(`#${gatewayHandoff([
    entry("http://127.0.0.1:8787", "", 900),
    entry("http://loft.test", "Loft older", 200),
    entry("http://studio.local:8787", "", 950),
  ])}`);

  assert.deepEqual(recoveryGateways(saved, carried, "http://studio.local:8787"), [
    { url: CURRENT, name: "127.0.0.1" },
    { url: "http://loft.test", name: "Loft" },
    { url: "http://attic.test", name: "attic.test" },
  ], "the gateway this page left is one tap away, and an empty name falls back to its hostname");

  // One row per address even when the carried rows repeat one, and the newer sighting wins.
  assert.deepEqual(recoveryGateways(
    [entry("http://loft.test", "Loft", 300)],
    [entry("http://loft.test", "Loft newer", 700), entry("http://loft.test", "Loft newer still", 800)],
    "http://studio.local:8787",
  ), [{ url: "http://loft.test", name: "Loft newer still" }]);

  // The gateway serving the page is never one of the rows, wherever it came from.
  assert.deepEqual(recoveryGateways([entry(CURRENT, "Here", 900)], [entry(CURRENT, "Here", 900)], CURRENT), []);
});

test("Add refuses anything the Add dialog refuses, in the Add dialog's own words", () => {
  const saved = [entry("http://loft.test", "Loft", 300)];
  const refuse = (address: string, pageProtocol = "http:"): string =>
    recoveryAddError({ address, current: CURRENT, saved, pageProtocol });

  assert.equal(refuse(""), GATEWAY_NOT_AN_ADDRESS);
  assert.equal(refuse("not an address"), "Enter an http:// or https:// address.");
  assert.equal(refuse("http://user:pass@host.test:8787"), GATEWAY_NOT_AN_ADDRESS, "credentials are refused, not dropped");
  assert.equal(refuse("http://host.test:8787?x=1"), GATEWAY_NOT_AN_ADDRESS);
  assert.equal(refuse("http://host.test:8787#x"), GATEWAY_NOT_AN_ADDRESS);
  assert.equal(refuse("ftp://host.test:8787"), GATEWAY_NOT_AN_ADDRESS);
  assert.equal(refuse("http://127.0.0.1:8787/"), GATEWAY_IS_CURRENT);
  assert.equal(refuse("127.0.0.1:8787"), GATEWAY_IS_CURRENT, "a scheme-less address is read as http");
  assert.equal(refuse("http://loft.test"), GATEWAY_ALREADY_SAVED);
  assert.equal(refuse("http://geekom.test:10447", "https:"), GATEWAY_MIXED_CONTENT);
  assert.equal(refuse("http://geekom.test:10447", "https:"),
    "This page is on https, so it can't reach an http:// gateway. Use the gateway's own https:// address.");

  // Loopback is this device, which a browser lets an https page reach, and an empty or scheme-less address is fine.
  assert.equal(refuse("http://127.0.0.1:4173", "https:"), "");
  assert.equal(refuse("http://localhost:4173", "https:"), "");
  assert.equal(refuse("studio.local:8787"), "");
  assert.equal(refuse("  http://studio.local:8787/  "), "", "a trailing slash is not a different gateway");
});

test("an address that does not answer as HUI is refused with the wording that fits where it is", () => {
  assert.equal(recoveryRefusal({ ok: false }, "http://127.0.0.1:4173"), loopbackRefusal("http://127.0.0.1:4173"));
  assert.equal(recoveryRefusal({ ok: false }, "http://localhost:4173"),
    "Nothing answered at http://localhost:4173. 127.0.0.1 and localhost name the device running this app, not another machine.");
  assert.equal(recoveryRefusal({ ok: false }, "http://loft.test"), GATEWAY_REFUSED);
  assert.equal(recoveryRefusal({ ok: true }, "http://loft.test"), "", "a gateway that answered is not refused");
});

test("a switch keeps the target and carries the gateway left behind first, with nothing typed into the address", () => {
  const saved = [entry("http://loft.test", "Loft", 300), entry("https://attic.test/hui", "", 100)];
  const address = recoverySwitchAddress("http://studio.local:8787", { url: CURRENT, name: "" }, saved, 1_000);
  const target = new URL(address);

  assert.equal(target.origin, "http://studio.local:8787");
  assert.equal(target.search, "");
  assert.equal(target.username, "");
  assert.equal(target.password, "");
  assert.ok(address.includes(`${GATEWAY_HANDOFF_PARAM}=`));
  const carried = readGatewayHandoff(`#${address.slice(address.indexOf("#") + 1)}`);
  assert.deepEqual(carried, [
    { url: CURRENT, name: "127.0.0.1", lastSeen: 1_000 },
    { url: "http://loft.test", name: "Loft", lastSeen: 300 },
    { url: "https://attic.test/hui", name: "", lastSeen: 100 },
  ], "the gateway this page leaves is one tap away from the page it opens");
});
