/** The gateway list's rules: which addresses are gateways, what a saved list reads as, and what each row shows. */
import assert from "node:assert/strict";
import { test } from "vitest";
import {
  addGateway,
  editGateway,
  GATEWAY_LIST_VERSION,
  gatewayName,
  gatewayViews,
  lastSeenLabel,
  markGatewaySeen,
  normalizeGatewayAddress,
  readGatewayHandshake,
  readGatewayList,
  removeGateway,
  writeGatewayList,
  type GatewayEntry,
} from "./gateway-list.ts";

const CURRENT = "http://127.0.0.1:8787";

test("an address means an http gateway, without a trailing slash, query, fragment or credentials", () => {
  assert.equal(normalizeGatewayAddress("  http://127.0.0.1:8787/ "), "http://127.0.0.1:8787");
  assert.equal(normalizeGatewayAddress("http://127.0.0.1:8787///"), "http://127.0.0.1:8787");
  assert.equal(normalizeGatewayAddress("192.168.1.4:8787"), "http://192.168.1.4:8787");
  assert.equal(normalizeGatewayAddress("localhost:8787"), "http://localhost:8787");
  assert.equal(normalizeGatewayAddress("https://Gateway.Example/"), "https://gateway.example");
  // A path HUI is served under is kept, as the phone app keeps it.
  assert.equal(normalizeGatewayAddress("https://example.test/hui/"), "https://example.test/hui");
  // A query, a fragment and credentials are refused rather than dropped.
  assert.equal(normalizeGatewayAddress("http://127.0.0.1:8787/?token=1"), null);
  assert.equal(normalizeGatewayAddress("http://127.0.0.1:8787/#top"), null);
  assert.equal(normalizeGatewayAddress("http://user:pass@127.0.0.1:8787"), null);
  assert.equal(normalizeGatewayAddress("ftp://127.0.0.1:8787"), null);
  assert.equal(normalizeGatewayAddress("   "), null);
  assert.equal(normalizeGatewayAddress("not an address"), null);
  assert.equal(normalizeGatewayAddress("[::1]:8787"), "http://[::1]:8787");
  assert.equal(normalizeGatewayAddress("studio.local:8787"), "http://studio.local:8787");
  assert.equal(normalizeGatewayAddress("https://studio.local/panel"), "https://studio.local/panel");
});

test("a corrupt, absent or foreign saved list reads as an empty one, and duplicates collapse", () => {
  assert.deepEqual(readGatewayList(null), []);
  assert.deepEqual(readGatewayList(""), []);
  assert.deepEqual(readGatewayList("{"), []);
  assert.deepEqual(readGatewayList("null"), []);
  assert.deepEqual(readGatewayList('{"version":1,"gateways":"nope"}'), []);
  assert.deepEqual(readGatewayList('{"version":1,"gateways":[{"url":"ftp://x"}]}'), []);
  const saved = JSON.stringify({
    version: GATEWAY_LIST_VERSION,
    gateways: [
      { url: "http://studio.local:8787/", name: "  Studio  ", lastSeen: 200 },
      { url: "http://studio.local:8787", name: "Duplicate", lastSeen: 100 },
      { url: "http://old.local:8787", name: 7, lastSeen: "soon" },
      { url: 9, name: "nowhere" },
      "nope",
    ],
  });
  assert.deepEqual(readGatewayList(saved), [
    { url: "http://studio.local:8787", name: "Studio", lastSeen: 200 },
    { url: "http://old.local:8787", name: "", lastSeen: 0 },
  ]);
  // Newest sighting first, whatever order it was saved in.
  assert.deepEqual(readGatewayList(writeGatewayList([
    { url: "http://a.test", name: "A", lastSeen: 1 },
    { url: "http://b.test", name: "B", lastSeen: 2 },
  ])).map((entry) => entry.url), ["http://b.test", "http://a.test"]);
});

const entries: GatewayEntry[] = [
  { url: "http://studio.local:8787", name: "Studio", lastSeen: 100 },
  { url: "http://loft.local:8787", name: "Loft", lastSeen: 50 },
];

test("one address is one row, newest first, and the gateway serving the page is never stored", () => {
  assert.deepEqual(addGateway(entries, { url: "http://new.local:8787", name: "New", lastSeen: 200 }, CURRENT)
    .map((entry) => entry.url), ["http://new.local:8787", "http://studio.local:8787", "http://loft.local:8787"]);
  assert.deepEqual(addGateway(entries, { url: "http://loft.local:8787/", name: "Loft again", lastSeen: 300 }, CURRENT), [
    { url: "http://loft.local:8787", name: "Loft again", lastSeen: 300 },
    { url: "http://studio.local:8787", name: "Studio", lastSeen: 100 },
  ]);
  assert.deepEqual(addGateway(entries, { url: CURRENT, name: "Here", lastSeen: 400 }, CURRENT), entries);
  assert.deepEqual(addGateway(entries, { url: "ftp://x", name: "No", lastSeen: 400 }, CURRENT), entries);
});

test("an edited gateway keeps its row and sighting, and a move cannot overwrite another row", () => {
  assert.deepEqual(editGateway(entries, "http://studio.local:8787", { url: "http://studio.local:8787", name: "Studio Mac", lastSeen: 100 }, CURRENT), [
    { url: "http://studio.local:8787", name: "Studio Mac", lastSeen: 100 },
    { url: "http://loft.local:8787", name: "Loft", lastSeen: 50 },
  ]);
  assert.deepEqual(editGateway(entries, "http://loft.local:8787", { url: "attic.local:8787", name: "Attic", lastSeen: 300 }, CURRENT), [
    { url: "http://attic.local:8787", name: "Attic", lastSeen: 300 },
    { url: "http://studio.local:8787", name: "Studio", lastSeen: 100 },
  ]);
  // Moving onto an address another row holds, onto this page's gateway, or from a row that is not saved changes nothing.
  assert.deepEqual(editGateway(entries, "http://loft.local:8787", { url: "http://studio.local:8787", name: "Both", lastSeen: 300 }, CURRENT), entries);
  assert.deepEqual(editGateway(entries, "http://loft.local:8787", { url: CURRENT, name: "Here", lastSeen: 300 }, CURRENT), entries);
  assert.deepEqual(editGateway(entries, "http://gone.local", { url: "http://new.local", name: "New", lastSeen: 300 }, CURRENT), entries);
  assert.deepEqual(editGateway(entries, "http://loft.local:8787", { url: "ftp://x", name: "No", lastSeen: 300 }, CURRENT), entries);
});

test("removing and marking seen leave the current gateway alone", () => {
  assert.deepEqual(removeGateway(entries, "http://loft.local:8787", CURRENT).map((entry) => entry.url), ["http://studio.local:8787"]);
  assert.deepEqual(removeGateway(entries, "http://missing.local", CURRENT), entries);
  assert.deepEqual(removeGateway(entries, CURRENT, CURRENT), entries);
  assert.deepEqual(markGatewaySeen(entries, "http://loft.local:8787", { name: "Loft 2", lastSeen: 900 }, CURRENT), [
    { url: "http://loft.local:8787", name: "Loft 2", lastSeen: 900 },
    { url: "http://studio.local:8787", name: "Studio", lastSeen: 100 },
  ]);
  assert.deepEqual(markGatewaySeen(entries, "http://studio.local:8787", { lastSeen: 900 }, CURRENT)[0]?.name, "Studio");
  assert.deepEqual(markGatewaySeen(entries, CURRENT, { name: "Renamed", lastSeen: 900 }, CURRENT), entries);
});

test("the current gateway leads the list, and an offline entry says so", () => {
  assert.deepEqual(gatewayViews(entries, { url: CURRENT, name: "This machine" }, ["http://loft.local:8787"]), [
    { url: CURRENT, name: "This machine", state: "current" },
    { url: "http://studio.local:8787", name: "Studio", state: "known", lastSeen: 100 },
    { url: "http://loft.local:8787", name: "Loft", state: "offline", lastSeen: 50 },
  ]);
  // An unnamed gateway shows the host it is reached at.
  assert.equal(gatewayViews([], { url: CURRENT, name: "" }, []).at(0)?.name, "127.0.0.1");
  assert.equal(gatewayName("  ", "https://gateway.example"), "gateway.example");
  assert.equal(gatewayName("Studio", "https://gateway.example"), "Studio");
});

test("last seen reads in minutes, hours and days", () => {
  const now = Date.UTC(2026, 10, 11);
  assert.equal(lastSeenLabel(now - 5_000, now), "just now");
  assert.equal(lastSeenLabel(now - 5 * 60_000, now), "5 min ago");
  assert.equal(lastSeenLabel(now - 3 * 3_600_000, now), "3 h ago");
  assert.equal(lastSeenLabel(now - 2 * 86_400_000, now), "2 d ago");
  assert.equal(lastSeenLabel(0, now), new Date(0).toISOString().slice(0, 10));
});

test("only HUI's own update snapshot counts as a handshake, and it carries the gateway's name", () => {
  assert.deepEqual(readGatewayHandshake({ currentVersion: "0.1.6", job: null, name: "Studio", check: null }), { name: "Studio" });
  assert.deepEqual(readGatewayHandshake({ currentVersion: null, job: null }), { name: "" });
  assert.equal(readGatewayHandshake({ currentVersion: 6, job: null }), null);
  assert.equal(readGatewayHandshake({ job: null }), null);
  assert.equal(readGatewayHandshake([{ currentVersion: "0.1.6", job: null }]), null);
  assert.equal(readGatewayHandshake("<html>"), null);
  assert.equal(readGatewayHandshake(null), null);
});
