/**
 * What a page keeps on this machine: its cookies and its local and session
 * storage, described by name and never by value.
 *
 * A cookie value or a storage value is usually a session token, and anything
 * printed here lands in a transcript that outlives the tab. So this module only
 * ever formats names, flags, sizes and expiry: "why am I logged out" is answered
 * by which cookies exist, on which domain, with which flags, not by their
 * contents. It is pure, so the rule is tested without a browser.
 */

export type CookieInfo = Readonly<{
  name: string;
  domain?: string;
  path?: string;
  /** Seconds since the epoch, or -1 for a session cookie. */
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: string;
  size?: number;
}>;

export type StorageEntry = Readonly<{ key: string; size: number }>;

const DAY = 86_400_000;

function duration(ms: number): string {
  if (ms < 60_000) return "in under a minute";
  if (ms < 3_600_000) return `in ${Math.round(ms / 60_000)} min`;
  if (ms < DAY) return `in ${Math.round(ms / 3_600_000)} h`;
  return `in ${Math.round(ms / DAY)} day${Math.round(ms / DAY) === 1 ? "" : "s"}`;
}

/** `in 2 days`, `expired 3 h ago`, `session` — relative to `now`. */
export function describeExpiry(expires: number | undefined, now: number): string {
  if (expires === undefined || expires === -1) return "session";
  const at = expires * 1_000;
  if (!Number.isFinite(at)) return "session";
  const difference = at - now;
  if (difference <= 0) return `expired ${duration(-difference).replace(/^in /u, "")} ago`;
  return duration(difference);
}

export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "unknown size";
  return bytes < 1_024 ? `${Math.round(bytes)} B` : `${(bytes / 1_024).toFixed(1)} KB`;
}

/** One cookie per line: name first, then the flags that decide whether it is sent. */
export function describeCookie(cookie: CookieInfo, now: number): string {
  const flags = [
    cookie.httpOnly === true ? "HttpOnly" : "",
    cookie.secure === true ? "Secure" : "",
    cookie.sameSite ? `SameSite=${cookie.sameSite}` : "",
    describeExpiry(cookie.expires, now),
    cookie.size === undefined ? "" : formatSize(cookie.size),
    cookie.path && cookie.path !== "/" ? `path ${cookie.path}` : "",
  ].filter(Boolean);
  return `${cookie.name}${flags.length ? ` · ${flags.join(" · ")}` : ""}`;
}

/** The cookies a page holds for the URL in view, without a single value. */
export function describeCookies(cookies: readonly CookieInfo[], options: { url: string; now: number }): string[] {
  const host = (() => {
    try {
      return new URL(options.url).host;
    } catch {
      return options.url;
    }
  })();
  if (!cookies.length) return [`No cookies for ${host}. Nothing is set yet, or the site keeps its session another way.`];
  const lines = [`${cookies.length} cookie${cookies.length === 1 ? "" : "s"} for ${host}, values hidden:`];
  for (const cookie of cookies) lines.push(`  ${describeCookie(cookie, options.now)}`);
  return lines;
}

const KIND_LABEL: Record<"local" | "session", string> = { local: "localStorage", session: "sessionStorage" };

/** The keys a page keeps in local or session storage, with their size and no value. */
export function describeStorage(kind: "local" | "session", entries: readonly StorageEntry[], origin: string): string[] {
  const label = KIND_LABEL[kind];
  if (!entries.length) return [`${label} is empty on ${origin}.`];
  const total = entries.reduce((sum, entry) => sum + entry.size, 0);
  const lines = [`${entries.length} ${label} key${entries.length === 1 ? "" : "s"} on ${origin} (${formatSize(total)}), values hidden:`];
  for (const entry of entries) lines.push(`  ${entry.key} · ${formatSize(entry.size)}`);
  return lines;
}

/** The filter shared by cookies and storage: a case-insensitive substring on the name. */
export function matching<T extends { name: string } | { key: string }>(items: readonly T[], filter: string): T[] {
  const needle = filter.trim().toLocaleLowerCase();
  if (!needle) return [...items];
  return items.filter((item) => ("name" in item ? item.name : item.key).toLocaleLowerCase().includes(needle));
}
