import assert from "node:assert/strict";
import { test } from "vitest";
import { describeCookie, describeCookies, describeExpiry, describeStorage, formatSize, matching } from "./storage.ts";

const NOW = Date.UTC(2026, 10, 9, 12, 0, 0);

test("a cookie line carries its flags and expiry but never its value", () => {
  const line = describeCookie({ name: "sid", httpOnly: true, secure: true, sameSite: "Lax", expires: Math.floor((NOW + 2 * 86_400_000) / 1_000), size: 32 }, NOW);
  assert.equal(line, "sid · HttpOnly · Secure · SameSite=Lax · in 2 days · 32 B");
  assert.equal(describeCookie({ name: "theme", expires: -1, size: 5 }, NOW), "theme · session · 5 B");
  assert.equal(describeCookie({ name: "pref", path: "/app", expires: Math.floor((NOW - 3 * 3_600_000) / 1_000) }, NOW), "pref · expired 3 h ago · path /app");
});

test("expiry reads as a session, a relative time or an age", () => {
  assert.equal(describeExpiry(-1, NOW), "session");
  assert.equal(describeExpiry(undefined, NOW), "session");
  assert.equal(describeExpiry(Math.floor((NOW + 30_000) / 1_000), NOW), "in under a minute");
  assert.equal(describeExpiry(Math.floor((NOW + 90 * 60_000) / 1_000), NOW), "in 2 h");
  assert.equal(describeExpiry(Math.floor((NOW - 5_000) / 1_000), NOW), "expired under a minute ago");
});

test("sizes read in bytes or one decimal of a kilobyte", () => {
  assert.equal(formatSize(412), "412 B");
  assert.equal(formatSize(2_048), "2.0 KB");
  assert.equal(formatSize(Number.NaN), "unknown size");
});

test("cookie and storage summaries count, name and size what they hold", () => {
  const cookies = describeCookies([
    { name: "sid", httpOnly: true, size: 32, expires: -1 },
    { name: "theme", size: 5, expires: -1 },
  ], { url: "https://example.com/inbox", now: NOW });
  assert.deepEqual(cookies, [
    "2 cookies for example.com, values hidden:",
    "  sid · HttpOnly · session · 32 B",
    "  theme · session · 5 B",
  ]);
  assert.deepEqual(describeCookies([], { url: "https://example.com", now: NOW }), [
    "No cookies for example.com. Nothing is set yet, or the site keeps its session another way.",
  ]);
  assert.deepEqual(describeStorage("local", [{ key: "draft", size: 5 }, { key: "seen", size: 2 }], "https://example.com"), [
    "2 localStorage keys on https://example.com (7 B), values hidden:",
    "  draft · 5 B",
    "  seen · 2 B",
  ]);
  assert.deepEqual(describeStorage("session", [], "https://example.com"), ["sessionStorage is empty on https://example.com."]);
});

test("a filter matches names case-insensitively and an empty filter keeps everything", () => {
  const items = [{ name: "sid" }, { name: "Theme" }];
  assert.deepEqual(matching(items, "TH"), [{ name: "Theme" }]);
  assert.deepEqual(matching(items, ""), items);
  assert.deepEqual(matching([{ key: "draft" }, { key: "seen" }], "dr"), [{ key: "draft" }]);
});
