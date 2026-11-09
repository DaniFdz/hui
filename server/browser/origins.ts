/**
 * Which pages a conversation's tabs may reach: Settings → Tools → Browser's
 * origin allowlist, matched in `manager.ts` before a navigation and on every
 * top-level document a tab lands on.
 *
 * A pattern names a host (`example.com`), a host and port (`example.com:8443`),
 * a scheme and host (`https://app.example.com`), or a subdomain wildcard
 * (`*.example.com`, which never covers the apex). An empty list keeps the
 * browser free to go anywhere, which is what a fresh install has. A pattern
 * that cannot be parsed matches nothing rather than everything, so a typo
 * locks pages out loudly instead of silently opening them.
 *
 * Names are not resolved: a host that resolves to a private address after the
 * check (DNS rebinding) is outside this model, and so are the subresources a
 * page loads once its document is allowed.
 */

export type OriginPattern = {
  scheme?: "http" | "https";
  host: string;
  port?: string;
  wildcard: boolean;
};

const MAX_PATTERNS = 50;
const MAX_PATTERN_LENGTH = 200;

export function parseOriginPattern(raw: string): OriginPattern | undefined {
  let text = raw.trim().toLowerCase();
  if (!text || text.length > MAX_PATTERN_LENGTH) return undefined;
  let scheme: OriginPattern["scheme"];
  const qualified = /^(https?):\/\//u.exec(text);
  if (qualified) {
    scheme = qualified[1] as "http" | "https";
    text = text.slice(qualified[0].length);
  }
  // A path, query or fragment names no origin of its own.
  text = text.split(/[/?#]/u)[0] ?? "";
  if (!text || text === "*") return undefined;
  let host = text;
  let port: string | undefined;
  const bracketed = /^(\[[0-9a-f:.]+\])(?::(\d{1,5}))?$/u.exec(text);
  if (bracketed) {
    host = bracketed[1]!;
    port = bracketed[2];
  } else {
    const colon = text.lastIndexOf(":");
    if (colon > 0) {
      host = text.slice(0, colon);
      port = text.slice(colon + 1);
      if (!/^\d{1,5}$/u.test(port) || Number(port) < 1 || Number(port) > 65_535) return undefined;
    }
  }
  let wildcard = false;
  if (host.startsWith("*.")) {
    wildcard = true;
    host = host.slice(2);
  }
  if (!host || host.includes("*") || /\s/u.test(host)) return undefined;
  return { ...(scheme ? { scheme } : {}), host, ...(port ? { port } : {}), wildcard };
}

/** What the settings store keeps: trimmed, lowercase, at most 50, no duplicates. */
export function normalizeOriginPatterns(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const patterns: string[] = [];
  for (const entry of value.slice(0, MAX_PATTERNS)) {
    if (typeof entry !== "string") continue;
    const text = entry.trim().toLowerCase();
    if (!text || text.length > MAX_PATTERN_LENGTH || /\s|[\p{Cc}]/u.test(text)) continue;
    if (!patterns.includes(text)) patterns.push(text);
  }
  return patterns;
}

/** Loopback, link-local and private ranges: only an exact host pattern may name one, never a wildcard. */
export function isPrivateHost(host: string): boolean {
  const name = host.toLowerCase().replace(/^\[|\]$/gu, "");
  if (name === "localhost" || name.endsWith(".localhost")) return true;
  if (name === "::1" || name === "::") return true;
  if (/^f[cd][0-9a-f]{2}:/u.test(name) || /^fe[89ab][0-9a-f]:/u.test(name)) return true;
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/u.exec(name);
  if (!ipv4) return false;
  const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
  return a === 10 || a === 127 || a === 0
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168);
}

function bareHost(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[|\]$/gu, "");
}

/** An empty list allows every page; `about:blank` is always allowed. */
export function allowsUrl(patterns: readonly string[], value: string | URL): boolean {
  if (patterns.length === 0) return true;
  let url: URL;
  try {
    url = value instanceof URL ? value : new URL(value);
  } catch {
    return false;
  }
  if (url.protocol === "about:") return true;
  // With a list set, a local file or any other scheme is out: it could read what the list keeps away.
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  return patterns.some((pattern) => matchesOrigin(parseOriginPattern(pattern), url));
}

function matchesOrigin(pattern: OriginPattern | undefined, url: URL): boolean {
  if (!pattern) return false;
  if (pattern.scheme && url.protocol !== `${pattern.scheme}:`) return false;
  if (pattern.port) {
    const port = url.port || (url.protocol === "https:" ? "443" : "80");
    if (pattern.port !== port) return false;
  }
  const host = bareHost(url.hostname);
  if (pattern.wildcard) return !isPrivateHost(host) && host.endsWith(`.${pattern.host}`);
  return host === pattern.host;
}

/** The list as an error message names it. */
export function describeOrigins(patterns: readonly string[]): string {
  return patterns.join(", ");
}

/** The one sentence an agent reads when a page is outside the list. */
export function blockedOriginMessage(patterns: readonly string[], url: string): string {
  let host = url;
  try {
    host = new URL(url).host;
  } catch {
    // Keep the raw value: the message still names what was refused.
  }
  return `${host} is not in this browser's allowed origins (${describeOrigins(patterns)}). The operator can change them in HUI Settings → Tools → Browser.`;
}
