/**
 * Importing a login the operator already has: a Playwright `storageState` file
 * or a bare list of cookies, read into HUI's `StoredCookie` shape so this
 * browser starts signed in where another one already was.
 *
 * Only the cookies are read; Playwright's `origins` and every other top-level
 * field are ignored. A cookie is kept as it is: a non-positive or absent expiry
 * is a session cookie and gets no expiry, a positive one stays in seconds (as
 * CDP and `StoredCookie` use), and one already past `now` is dropped and
 * counted. Two entries for one domain, path and name are one cookie, the later
 * winning. A file that is not a cookie export, is over the size or count bound,
 * or holds an entry that is not a well-formed cookie — including a name or a
 * value Chromium will not store — is refused by that entry's number and field,
 * never by what it contained.
 *
 * It is pure — the caller passes `now`, and nothing here reads a file, opens a
 * socket or looks at a clock — and value-free by construction: a refusal names a
 * cookie and a field, and `cookieImportReport` only ever counts entries and
 * domains, so a cookie's value or name cannot reach a transcript through it.
 */
import { MAX_STATE_COOKIES, type StoredCookie } from "./state.ts";

/** A file past this is not an export someone typed: it is a mistake, and reading it would cost more than it is worth. */
export const MAX_COOKIE_IMPORT_BYTES = 4 * 1024 * 1024;
/** How many domains the report names before it only counts the rest. */
const REPORT_DOMAINS = 50;
/** Chromium refuses a cookie whose name and value are over 4 KiB, so keeping one would park an import that can never
 * apply and hold back every cookie beside it. */
const MAX_COOKIE_BYTES = 4_096;
/** RFC 6265's token: the only shape of name Chromium stores. One outside it makes Chromium refuse a whole seed batch. */
const COOKIE_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/u;
/** Chromium drops a cookie whose value holds a `;`, a control character or a line break — and the whole batch with it. */
const COOKIE_VALUE = /[\u0000-\u001f\u007f;]/u;

const NOT_AN_EXPORT = "That is not a cookie export. Use a Playwright storageState file or a list of cookies.";
const NOTHING_VALID = "No cookie in that file is still valid.";

/** A refused import: the message is safe to show, since it never carries file text. */
export class CookieImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CookieImportError";
  }
}

export type CookieImport = { cookies: StoredCookie[]; expired: number };

/**
 * What an exported login becomes: the cookies still valid at `now`, distinct by
 * domain, path and name, and how many entries were dropped for having expired.
 */
export function parseCookieImport(text: string, now: number): CookieImport {
  if (Buffer.byteLength(text, "utf8") > MAX_COOKIE_IMPORT_BYTES) throw new CookieImportError("That file is larger than 4 MiB.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // V8's message quotes the input, which is a cookie value as often as not.
    throw new CookieImportError("That file is not valid JSON.");
  }
  const entries = cookieEntries(parsed);
  if (!entries) throw new CookieImportError(NOT_AN_EXPORT);
  if (entries.length > MAX_STATE_COOKIES) throw new CookieImportError(`A cookie export holds at most ${MAX_STATE_COOKIES} cookies.`);
  const cookies = new Map<string, StoredCookie>();
  let expired = 0;
  for (const [index, entry] of entries.entries()) {
    const cookie = parseCookie(entry, index + 1, now);
    if (!cookie) {
      expired += 1;
      continue;
    }
    // A later entry for one identity replaces the earlier one in its place, as a merge does.
    cookies.set(`${cookie.domain}\u0000${cookie.path}\u0000${cookie.name}`, cookie);
  }
  const kept = [...cookies.values()];
  if (!kept.length) throw new CookieImportError(NOTHING_VALID);
  return { cookies: kept, expired };
}

/**
 * The line a session shows after an import: what came in, how many entries had
 * expired, and on which domains — never a cookie's name or value, because it is
 * never handed one.
 */
export function cookieImportReport(result: CookieImport): string {
  const total = result.cookies.length;
  const domains = [...new Set(result.cookies.map((cookie) => cookie.domain))].sort();
  const lines = [
    `imported ${total} cookie${total === 1 ? "" : "s"} for ${domains.length} domain${domains.length === 1 ? "" : "s"} (${result.expired} expired dropped)`,
  ];
  if (total > 0) {
    const shown = domains.slice(0, REPORT_DOMAINS);
    const rest = domains.length - shown.length;
    lines.push(`domains: ${shown.join(", ")}${rest > 0 ? `, and ${rest} more` : ""}`);
  }
  return lines.join("\n");
}

/** A list of cookies, or a Playwright `storageState`; anything else is not an export. */
function cookieEntries(value: unknown): unknown[] | undefined {
  if (Array.isArray(value)) return value;
  if (typeof value !== "object" || value === null) return undefined;
  const cookies = (value as { cookies?: unknown }).cookies;
  return Array.isArray(cookies) ? cookies : undefined;
}

/** One entry as a `StoredCookie`, or `undefined` when it has already expired. */
function parseCookie(entry: unknown, number: number, now: number): StoredCookie | undefined {
  const at = `Cookie ${number} `;
  if (typeof entry !== "object" || entry === null || Array.isArray(entry)) throw new CookieImportError(`${at}is not an object.`);
  const source = entry as Record<string, unknown>;
  const name = source["name"];
  if (typeof name !== "string" || name === "") throw new CookieImportError(`${at}has no name.`);
  if (!COOKIE_NAME.test(name)) throw new CookieImportError(`${at}has a name Chromium will not store.`);
  const domain = source["domain"];
  if (typeof domain !== "string" || domain === "") throw new CookieImportError(`${at}has no domain.`);
  // A domain is matched against a request, never split: whitespace, a control character or a format character (a bidi
  // override among them) could only be a mistake.
  if (/\s|[\p{Cc}\p{Cf}]/u.test(domain)) throw new CookieImportError(`${at}has a domain with whitespace or a control or format character.`);
  const path = source["path"];
  if (typeof path !== "string" || path === "") throw new CookieImportError(`${at}has no path.`);
  if (!path.startsWith("/")) throw new CookieImportError(`${at}has a path that does not start with "/".`);
  const value = source["value"];
  if (typeof value !== "string") throw new CookieImportError(`${at}has a value that is not a string.`);
  if (COOKIE_VALUE.test(value)) throw new CookieImportError(`${at}has a value Chromium will not store.`);
  if (Buffer.byteLength(name, "utf8") + Buffer.byteLength(value, "utf8") > MAX_COOKIE_BYTES) throw new CookieImportError(`${at}has a value Chromium will not store.`);
  const httpOnly = flag(source, "httpOnly", at);
  const secure = flag(source, "secure", at);
  const sameSite = source["sameSite"];
  if (sameSite !== undefined && sameSite !== "Strict" && sameSite !== "Lax" && sameSite !== "None") {
    throw new CookieImportError(`${at}has an unknown sameSite.`);
  }
  // Chromium drops a SameSite=None cookie without Secure, so importing one would import a login that does not work.
  if (sameSite === "None" && secure !== true) throw new CookieImportError(`${at}has sameSite None without secure.`);
  const expires = source["expires"];
  if (expires !== undefined && (typeof expires !== "number" || !Number.isFinite(expires))) {
    throw new CookieImportError(`${at}has an expires that is not a finite number.`);
  }
  // Playwright writes -1 for a session cookie; anything not in the future is one too, and carries no expiry.
  if (typeof expires === "number" && expires > 0 && expires * 1_000 < now) return undefined;
  return {
    name,
    value,
    domain,
    path,
    at: now,
    ...(typeof expires === "number" && expires > 0 ? { expires } : {}),
    ...(httpOnly === true ? { httpOnly: true } : {}),
    ...(secure === true ? { secure: true } : {}),
    ...(sameSite === "Strict" || sameSite === "Lax" || sameSite === "None" ? { sameSite } : {}),
  };
}

function flag(source: Record<string, unknown>, field: "httpOnly" | "secure", at: string): boolean {
  const value = source[field];
  if (value === undefined) return false;
  if (typeof value !== "boolean") throw new CookieImportError(`${at}has ${field} that is not true or false.`);
  return value;
}
