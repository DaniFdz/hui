/**
 * Importing an exported login: what a Playwright storageState file and a bare
 * list of cookies become, which entries are refused and by what, and proof that
 * neither a report nor a refusal can carry a cookie's value back out.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { CookieImportError, MAX_COOKIE_IMPORT_BYTES, cookieImportReport, parseCookieImport } from "./cookie-import.ts";

const NOW = Date.UTC(2026, 10, 9, 12, 0, 0);
const FUTURE = Math.floor(NOW / 1_000) + 86_400;
const PAST = Math.floor(NOW / 1_000) - 86_400;
/** A cookie value no report or refusal may ever repeat back. */
const SECRET = `value-${crypto.randomUUID()}`;
const NOT_AN_EXPORT = "That is not a cookie export. Use a Playwright storageState file or a list of cookies.";

const cookie = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  name: "sid", value: SECRET, domain: ".example.com", path: "/", expires: FUTURE, ...overrides,
});

/** The message of a refusal, with proof that it carries no value and no JSON of the file back out. */
function refusal(action: () => unknown, secret: string): string {
  try {
    action();
  } catch (error) {
    assert.ok(error instanceof CookieImportError, `expected a CookieImportError, got ${String(error)}`);
    assert.equal(error.name, "CookieImportError");
    assert.equal(error.message.includes(secret), false, "a refusal never echoes a cookie value");
    assert.equal(error.message.includes("{"), false, "a refusal never echoes a JSON snippet");
    return error.message;
  }
  assert.fail("the file was accepted");
}

test("a Playwright storageState imports the cookies still valid and ignores everything else", () => {
  const text = JSON.stringify({
    cookies: [
      cookie({ name: "sid", domain: ".example.com" }),
      cookie({ name: "theme", domain: "app.example.com", value: "" }),
      cookie({ name: "gone", expires: PAST }),
    ],
    origins: [{ origin: "https://example.com", localStorage: [{ name: "token", value: SECRET }] }],
  });
  const result = parseCookieImport(text, NOW);
  assert.equal(result.expired, 1, "the expired cookie is counted");
  assert.deepEqual(result.cookies.map((entry) => entry.name), ["sid", "theme"]);
  assert.deepEqual(result.cookies.map((entry) => entry.domain), [".example.com", "app.example.com"]);
  assert.deepEqual(result.cookies.map((entry) => entry.at), [NOW, NOW], "every imported cookie is captured now");
  assert.equal(result.cookies[1]!.value, "", "an empty string is a cookie value");
  assert.equal(result.cookies[0]!.expires, FUTURE, "a future expiry keeps its seconds");
  assert.equal("origins" in result, false, "origins are not imported");
});

test("a bare list of the same cookies is the same import", () => {
  const cookies = [cookie({ name: "sid" }), cookie({ name: "theme", domain: "app.example.com" })];
  assert.deepEqual(parseCookieImport(JSON.stringify(cookies), NOW), parseCookieImport(JSON.stringify({ cookies, origins: [] }), NOW));
});

test("an expiry of -1, of 0 or none at all is a session cookie", () => {
  const result = parseCookieImport(JSON.stringify([
    cookie({ name: "playwright", expires: -1 }),
    cookie({ name: "zero", expires: 0 }),
    cookie({ name: "absent", expires: undefined }),
  ]), NOW);
  assert.equal(result.expired, 0);
  assert.deepEqual(result.cookies.map((entry) => entry.name), ["playwright", "zero", "absent"]);
  for (const entry of result.cookies) assert.equal("expires" in entry, false, `${entry.name} carries no expiry`);
  assert.deepEqual(Object.keys(result.cookies[0]!).sort(), ["at", "domain", "name", "path", "value"], "only the fields a session cookie has");
});

test("an expired cookie is dropped and counted, never stored", () => {
  const stale = `stale-${crypto.randomUUID()}`;
  const result = parseCookieImport(JSON.stringify([cookie({ name: "sid" }), cookie({ name: "stale", value: stale, expires: PAST })]), NOW);
  assert.deepEqual(result.cookies.map((entry) => entry.name), ["sid"]);
  assert.equal(result.expired, 1);
  assert.equal(result.cookies.some((entry) => entry.value === stale), false);
  assert.equal(parseCookieImport(JSON.stringify([cookie({ expires: NOW / 1_000 })]), NOW).expired, 0, "an expiry at exactly now is not past yet");
});

test("a file that is not JSON is refused without echoing it", () => {
  const leaked = `secret-${crypto.randomUUID()}`;
  const text = `{"cookies":[{"name":"sid","value":"${leaked}"}`;
  assert.equal(refusal(() => parseCookieImport(text, NOW), leaked), "That file is not valid JSON.");
});

test("anything that is not a cookie export is refused", () => {
  const leaked = `token-${crypto.randomUUID()}`;
  const texts = [
    "null",
    JSON.stringify("text"),
    "{\"cookies\":{}}",
    `{"foo":[],"token":"${leaked}"}`,
    `{"origins":[{"origin":"https://example.com","token":"${leaked}"}]}`,
  ];
  for (const text of texts) assert.equal(refusal(() => parseCookieImport(text, NOW), leaked), NOT_AN_EXPORT, text);
});

test("a malformed cookie is refused by its number and field, never by its value", () => {
  const leaked = `value-${crypto.randomUUID()}`;
  const cases: Array<[string, unknown, string]> = [
    ["no name", cookie({ name: undefined }), "Cookie 2 has no name."],
    ["an empty name", cookie({ name: "" }), "Cookie 2 has no name."],
    ["no domain", cookie({ domain: undefined }), "Cookie 2 has no domain."],
    ["a domain with a space", cookie({ domain: "exa mple.com" }), "Cookie 2 has a domain with whitespace or a control or format character."],
    ["a domain with a control character", cookie({ domain: "example.com\u0007" }), "Cookie 2 has a domain with whitespace or a control or format character."],
    ["no path", cookie({ path: undefined }), "Cookie 2 has no path."],
    ["a path without a slash", cookie({ path: "app" }), "Cookie 2 has a path that does not start with \"/\"."],
    ["a value that is not a string", cookie({ value: 42 }), "Cookie 2 has a value that is not a string."],
    ["no value", cookie({ value: undefined }), "Cookie 2 has a value that is not a string."],
    ["an expires that is text", cookie({ expires: "tomorrow" }), "Cookie 2 has an expires that is not a finite number."],
    ["an unknown sameSite", cookie({ sameSite: "strict" }), "Cookie 2 has an unknown sameSite."],
    ["sameSite None without secure", cookie({ sameSite: "None" }), "Cookie 2 has sameSite None without secure."],
    ["an httpOnly that is not a boolean", cookie({ httpOnly: "yes" }), "Cookie 2 has httpOnly that is not true or false."],
    ["a secure that is not a boolean", cookie({ secure: 1 }), "Cookie 2 has secure that is not true or false."],
    ["a cookie that is a string", "a cookie", "Cookie 2 is not an object."],
    ["a cookie that is null", null, "Cookie 2 is not an object."],
    ["a cookie that is a list", [], "Cookie 2 is not an object."],
  ];
  for (const [label, entry, message] of cases) {
    const text = JSON.stringify([cookie({ name: "good", value: leaked }), entry]);
    assert.equal(refusal(() => parseCookieImport(text, NOW), leaked), message, label);
  }
  // JSON cannot spell Infinity, but it can spell a number too large for one.
  const infinite = `{"cookies":[${JSON.stringify(cookie({ name: "good", value: leaked }))},{"name":"eternal","value":"${leaked}","domain":".example.com","path":"/","expires":1e999}]}`;
  assert.equal(refusal(() => parseCookieImport(infinite, NOW), leaked), "Cookie 2 has an expires that is not a finite number.");
  const third = JSON.stringify([cookie({ name: "first" }), cookie({ name: "second" }), cookie({ name: "", value: leaked })]);
  assert.equal(refusal(() => parseCookieImport(third, NOW), leaked), "Cookie 3 has no name.", "the number is the entry's place in the file");
  // A right-to-left override is a format character: it could reorder the domains line the operator reads, so it is
  // refused like a control character and the domain is never repeated back.
  const bidiDomain = "evil\u202Eexample.test";
  const bidi = JSON.stringify([cookie({ name: "good", value: leaked }), cookie({ name: "bidi", domain: bidiDomain })]);
  const bidiRefusal = refusal(() => parseCookieImport(bidi, NOW), leaked);
  assert.equal(bidiRefusal, "Cookie 2 has a domain with whitespace or a control or format character.");
  assert.equal(bidiRefusal.includes(bidiDomain), false, "a refusal never echoes the domain it refused");
});

test("a file over 4 MiB or over 2000 cookies is refused", () => {
  const huge = JSON.stringify({ cookies: [cookie({ value: "v".repeat(MAX_COOKIE_IMPORT_BYTES) })] });
  assert.ok(Buffer.byteLength(huge, "utf8") > MAX_COOKIE_IMPORT_BYTES);
  assert.equal(refusal(() => parseCookieImport(huge, NOW), SECRET), "That file is larger than 4 MiB.");
  // Bytes, not characters: under 4M characters and over 4 MiB.
  const accented = "é".repeat(MAX_COOKIE_IMPORT_BYTES / 2 + 1);
  assert.ok(accented.length < MAX_COOKIE_IMPORT_BYTES);
  assert.ok(Buffer.byteLength(accented, "utf8") > MAX_COOKIE_IMPORT_BYTES);
  assert.equal(refusal(() => parseCookieImport(accented, NOW), SECRET), "That file is larger than 4 MiB.");
  const many = Array.from({ length: 2_001 }, (_, index) => cookie({ name: `cookie${index}` }));
  assert.equal(refusal(() => parseCookieImport(JSON.stringify(many), NOW), SECRET), "A cookie export holds at most 2000 cookies.");
  assert.equal(parseCookieImport(JSON.stringify(many.slice(0, 2_000)), NOW).cookies.length, 2_000, "exactly 2000 is allowed");
});

test("the same cookie twice collapses to one, the later entry winning", () => {
  const first = `first-${crypto.randomUUID()}`;
  const second = `second-${crypto.randomUUID()}`;
  const result = parseCookieImport(JSON.stringify([
    cookie({ name: "sid", value: first }),
    cookie({ name: "other", value: `other-${crypto.randomUUID()}` }),
    cookie({ name: "sid", value: second, secure: true, sameSite: "Lax" }),
  ]), NOW);
  assert.deepEqual(result.cookies.map((entry) => entry.name), ["sid", "other"], "one cookie per identity, in file order");
  assert.equal(result.cookies[0]!.value, second, "the later value wins");
  assert.equal(result.cookies[0]!.secure, true, "with its own flags");
  assert.equal(result.cookies[0]!.sameSite, "Lax");
  assert.equal(result.expired, 0, "a collapse is not an expiry");
  const identities = JSON.stringify([cookie({ path: "/" }), cookie({ path: "/app" }), cookie({ path: "/app", domain: "app.example.com" })]);
  assert.equal(parseCookieImport(identities, NOW).cookies.length, 3, "another path or domain is another cookie");
});

test("a later entry that has expired does not replace the one before it", () => {
  const live = `live-${crypto.randomUUID()}`;
  const result = parseCookieImport(JSON.stringify([cookie({ name: "sid", value: live }), cookie({ name: "sid", expires: PAST })]), NOW);
  assert.equal(result.cookies.length, 1);
  assert.equal(result.cookies[0]!.value, live);
  assert.equal(result.expired, 1);
});

test("a file where nothing survives is refused", () => {
  const texts = ["[]", "{\"cookies\":[]}", JSON.stringify([cookie({ expires: PAST })]), JSON.stringify([cookie({ expires: 1 })])];
  for (const text of texts) assert.equal(refusal(() => parseCookieImport(text, NOW), SECRET), "No cookie in that file is still valid.", text);
});

test("the report counts what came in and names its domains, sorted and deduplicated", () => {
  const result = parseCookieImport(JSON.stringify([
    cookie({ name: "sid", domain: ".example.com" }),
    cookie({ name: "theme", domain: "app.example.com" }),
    cookie({ name: "gone", domain: ".example.com", expires: PAST }),
  ]), NOW);
  assert.equal(cookieImportReport(result), [
    "imported 2 cookies for 2 domains (1 expired dropped)",
    "domains: .example.com, app.example.com",
  ].join("\n"));
  const one = parseCookieImport(JSON.stringify([cookie({ name: "sid", domain: "app.example.com" })]), NOW);
  assert.equal(cookieImportReport(one), [
    "imported 1 cookie for 1 domain (0 expired dropped)",
    "domains: app.example.com",
  ].join("\n"));
  const two = parseCookieImport(JSON.stringify([cookie({ name: "a", domain: "b.example" }), cookie({ name: "b", domain: "b.example" })]), NOW);
  assert.equal(cookieImportReport(two).split("\n")[0], "imported 2 cookies for 1 domain (0 expired dropped)");
});

test("a cookie whose name and value Chromium will not store is refused without echoing it", () => {
  const fits = parseCookieImport(JSON.stringify([cookie({ name: "n", value: "v".repeat(4_095) })]), NOW);
  assert.equal(fits.cookies.length, 1, "4 KiB of name and value is stored");
  const over = "v".repeat(4_096);
  assert.equal(
    refusal(() => parseCookieImport(JSON.stringify([cookie({ name: "n", value: over })]), NOW), over),
    "Cookie 1 has a value Chromium will not store.",
    "one byte over is refused, by number and field only",
  );
  // Bytes, not characters: 2047 accented characters plus the name are 4095 bytes, one more is over.
  assert.equal(parseCookieImport(JSON.stringify([cookie({ name: "n", value: "é".repeat(2_047) })]), NOW).cookies.length, 1);
  const accented = "é".repeat(2_048);
  assert.equal(
    refusal(() => parseCookieImport(JSON.stringify([cookie({ name: "n", value: accented })]), NOW), accented),
    "Cookie 1 has a value Chromium will not store.",
  );
});

test("a name that is not an RFC 6265 token is refused without echoing it", () => {
  const leaked = `value-${crypto.randomUUID()}`;
  // Chromium rejects a whole seed batch over one such name, so the import is refused before it is parked.
  for (const name of ["na me", "na;me", "na=me", "na\"me", "na,me", "na/me", "na(me)", "na\u00e9", "na\u0000me"]) {
    const refused = refusal(() => parseCookieImport(JSON.stringify([cookie({ name, value: leaked })]), NOW), leaked);
    assert.equal(refused, "Cookie 1 has a name Chromium will not store.", JSON.stringify(name));
    assert.equal(refused.includes(name), false, "a refusal names the field, never the name");
  }
  const later = JSON.stringify([cookie({ name: "good", value: leaked }), cookie({ name: "bad name", value: leaked })]);
  assert.equal(refusal(() => parseCookieImport(later, NOW), leaked), "Cookie 2 has a name Chromium will not store.", "by the entry's place");
});

test("a value with a semicolon, a line break or a control character is refused without echoing it", () => {
  // Chromium stores none of these, and rejects the rest of the batch with them.
  for (const value of ["a;b", "a\rb", "a\nb", "a\u0000b", "a\u001fb", "a\u007fb"]) {
    const refused = refusal(() => parseCookieImport(JSON.stringify([cookie({ value })]), NOW), value);
    assert.equal(refused, "Cookie 1 has a value Chromium will not store.", JSON.stringify(value));
    assert.equal(refused.includes(value), false, "a refusal names the field, never the value");
  }
  const later = JSON.stringify([cookie({ name: "good", value: "ok" }), cookie({ name: "bad", value: "x;y" })]);
  assert.equal(refusal(() => parseCookieImport(later, NOW), "x;y"), "Cookie 2 has a value Chromium will not store.");
  // A space and every printable character outside those are values Chromium keeps.
  assert.equal(parseCookieImport(JSON.stringify([cookie({ value: "a b=c:/é" })]), NOW).cookies.length, 1);
});

test("the report names at most 50 domains and counts the rest", () => {
  const domains = Array.from({ length: 53 }, (_, index) => `site${String(52 - index).padStart(2, "0")}.example`);
  const all = [...domains, domains[0]!].map((domain, index) => cookie({ name: `c${index}`, domain }));
  const [line, listed] = cookieImportReport(parseCookieImport(JSON.stringify(all), NOW)).split("\n");
  assert.equal(line, "imported 54 cookies for 53 domains (0 expired dropped)");
  assert.equal(listed, `domains: ${domains.slice().sort().slice(0, 50).join(", ")}, and 3 more`, "sorted, and the rest counted");
  const fifty = cookieImportReport(parseCookieImport(JSON.stringify(domains.slice(0, 50).map((domain) => cookie({ domain }))), NOW)).split("\n")[1];
  assert.equal(fifty, `domains: ${domains.slice(0, 50).sort().join(", ")}`, "exactly 50 names them all");
});

test("no report or refusal can carry a cookie's value or name", () => {
  const value = `value-${crypto.randomUUID()}`;
  const name = `name-${crypto.randomUUID()}`;
  const result = parseCookieImport(JSON.stringify([cookie({ name, value, domain: "app.example.com" })]), NOW);
  const report = cookieImportReport(result);
  assert.equal(report, "imported 1 cookie for 1 domain (0 expired dropped)\ndomains: app.example.com");
  assert.equal(report.includes(value), false);
  assert.equal(report.includes(name), false);
  const refused = refusal(() => parseCookieImport(JSON.stringify([cookie({ name, value, domain: "app example.com" })]), NOW), value);
  assert.equal(refused.includes(name), false);
  assert.equal(refused.includes(value), false);
});
