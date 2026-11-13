/** Pattern matching for the browser's origin allowlist: hosts, ports, schemes, wildcards and what must be literal. */
import assert from "node:assert/strict";
import { test } from "vitest";
import { allowsUrl, blockedOriginMessage, isPrivateHost, normalizeOriginPatterns, parseOriginPattern } from "./origins.ts";

test("patterns name a host, a port, a scheme or a subdomain wildcard", () => {
  assert.deepEqual(parseOriginPattern("example.com"), { host: "example.com", wildcard: false });
  assert.deepEqual(parseOriginPattern(" Example.COM:8443 "), { host: "example.com", port: "8443", wildcard: false });
  assert.deepEqual(parseOriginPattern("https://app.example.com"), { scheme: "https", host: "app.example.com", wildcard: false });
  assert.deepEqual(parseOriginPattern("https://app.example.com:443/login?x=1"), { scheme: "https", host: "app.example.com", port: "443", wildcard: false });
  assert.deepEqual(parseOriginPattern("*.example.com"), { host: "example.com", wildcard: true });
  assert.deepEqual(parseOriginPattern("http://[::1]:3000"), { scheme: "http", host: "[::1]", port: "3000", wildcard: false });
  for (const bad of ["", "   ", "*", "ftp://example.com", "example.com:notaport", "example.com:0", "*.", "*.*.example.com", "exa mple.com", "a".repeat(201)]) {
    assert.equal(parseOriginPattern(bad), undefined, bad);
  }
});

test("an empty list keeps the browser free; a set list matches hosts, ports and schemes", () => {
  assert.equal(allowsUrl([], "https://anything.example/path"), true);
  const list = ["example.com", "*.docs.example.com", "127.0.0.1:5199", "https://secure.example.org"];
  assert.equal(allowsUrl(list, "https://example.com/a"), true);
  assert.equal(allowsUrl(list, "http://example.com:8080/a"), true, "a bare host ignores the port and scheme");
  assert.equal(allowsUrl(list, "https://sub.docs.example.com/"), true, "a wildcard covers subdomains");
  assert.equal(allowsUrl(list, "https://docs.example.com/"), false, "a wildcard never covers the apex");
  assert.equal(allowsUrl(list, "https://example.com.evil.test/"), false);
  assert.equal(allowsUrl(list, "http://127.0.0.1:5199/"), true);
  assert.equal(allowsUrl(list, "http://127.0.0.1:5200/"), false, "a port pattern is exact");
  assert.equal(allowsUrl(list, "https://secure.example.org/"), true);
  assert.equal(allowsUrl(list, "http://secure.example.org/"), false, "a scheme pattern is exact");
  assert.equal(allowsUrl(list, "https://secure.example.org:8443/"), true, "a scheme pattern without a port keeps every port");
  assert.equal(allowsUrl(list, "file:///tmp/report.html"), false, "a local file is outside a list");
  assert.equal(allowsUrl(list, "about:blank"), true);
  assert.equal(allowsUrl(["not a host"], "https://example.com/"), false, "an unparseable pattern matches nothing");
});

test("private addresses need an exact host, never a wildcard", () => {
  for (const host of ["127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.1.5", "169.254.169.254", "localhost", "api.localhost", "::1", "fd00::1"]) {
    assert.equal(isPrivateHost(host), true, host);
  }
  for (const host of ["example.com", "8.8.8.8", "172.32.0.1"]) assert.equal(isPrivateHost(host), false, host);
  assert.equal(allowsUrl(["*.0.0.1"], "http://127.0.0.1/"), false);
  assert.equal(allowsUrl(["127.0.0.1"], "http://127.0.0.1/"), true);
});

test("the stored list is trimmed, lowercased and bounded", () => {
  assert.deepEqual(normalizeOriginPatterns([" Example.com ", "example.com", "", 7, "bad host", "*.Docs.Example.com"]), ["example.com", "*.docs.example.com"]);
  assert.deepEqual(normalizeOriginPatterns("example.com"), []);
  assert.equal(normalizeOriginPatterns(Array.from({ length: 60 }, (_, index) => `host${index}.example`)).length, 50);
  assert.match(blockedOriginMessage(["example.com"], "https://evil.test/a"), /^evil\.test is not in this browser's allowed origins \(example\.com\)/u);
});
