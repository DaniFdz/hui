/**
 * Webhook triggers' source (HUI-18): `POST /__hui/hooks/<token>` on the gateway. Each webhook trigger has its own
 * random token, shown once when it is made (or replaced) and stored only as its SHA-256. The route takes no `x-hui`
 * header, since the callers are other programs; the token is the credential.
 *
 * The gateway stays on the tailnet: the route answers only callers on this machine (loopback, which is also how
 * `tailscale serve` reaches a loopback gateway) or on Tailscale's own addresses, and the gateway's Host check applies
 * as on every route. Exposing it to the internet (Tailscale Funnel) is the operator's choice, never HUI's.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { isIPv4, isIPv6 } from "node:net";

import { BOT_TRIGGER_HOOK_PREFIX, BOT_TRIGGER_LIMITS, type WebhookTriggerMatch } from "../shared/bot-triggers.ts";

/** `/__hui/hooks/<token>`: base64url, as `newHookToken` makes them (43 characters), within bounds for older ones. */
export const HOOK_ROUTE = /^\/__hui\/hooks\/([A-Za-z0-9_-]{20,128})$/u;
/** Anything under the prefix, so a malformed token is a 404 of this route, not of the API's guard. */
export const isHookPath = (path: string): boolean => path.startsWith(BOT_TRIGGER_HOOK_PREFIX);

export type HookToken = { token: string; hash: string; hint: string };

/** 32 random bytes, base64url: the token, its SHA-256 (what is stored) and its first four characters (what is shown). */
export function newHookToken(): HookToken {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashHookToken(token), hint: token.slice(0, 4) };
}

export function hashHookToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Constant-time comparison of two SHA-256 hex digests. */
export function sameHash(a: string, b: string): boolean {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  return left.length === 32 && right.length === 32 && timingSafeEqual(left, right);
}

/** Loopback (127.0.0.0/8, ::1) or Tailscale's addresses (100.64.0.0/10, fd7a:115c:a1e0::/48). */
export function isTailnetOrLoopback(address: string | undefined): boolean {
  if (!address) return false;
  const value = address.toLowerCase().replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/u, "");
  if (isIPv4(value)) {
    const [a, b] = value.split(".").map(Number) as [number, number];
    return a === 127 || (a === 100 && b >= 64 && b <= 127);
  }
  if (isIPv6(value)) return value === "::1" || value.startsWith("fd7a:115c:a1e0:");
  return false;
}

/** A body the route refuses: too large (413) or unreadable (400). */
export class HookBodyError extends Error {
  readonly status: 400 | 413;
  constructor(message: string, status: 400 | 413) {
    super(message);
    this.name = "HookBodyError";
    this.status = status;
  }
}

export type HookBody =
  | { kind: "json"; value: unknown; bytes: number; type: string }
  | { kind: "text"; value: string; bytes: number; type: string };

/** The body, at most `maxBytes`: JSON when its type says so (`application/json`, `…+json`), else text. */
export async function readHookBody(request: IncomingMessage, maxBytes: number = BOT_TRIGGER_LIMITS.body): Promise<HookBody> {
  const declared = Number(request.headers["content-length"]);
  if (Number.isFinite(declared) && declared > maxBytes) throw new HookBodyError(`The body is larger than ${maxBytes / 1024} KiB.`, 413);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > maxBytes) throw new HookBodyError(`The body is larger than ${maxBytes / 1024} KiB.`, 413);
    chunks.push(buffer);
  }
  const type = String(request.headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase();
  const raw = Buffer.concat(chunks).toString("utf8");
  if (type === "application/json" || type.endsWith("+json")) {
    try {
      return { kind: "json", value: JSON.parse(raw), bytes: size, type };
    } catch {
      throw new HookBodyError("The body says it is JSON but isn't.", 400);
    }
  }
  return { kind: "text", value: raw, bytes: size, type: type || "text/plain" };
}

/** The value at a dot path (`pull_request.state`, `commits.0.id`); undefined when the path leads nowhere. */
export function fieldAt(value: unknown, path: string): unknown {
  let current = value;
  for (const key of path.split(".")) {
    if (Array.isArray(current) && /^\d+$/u.test(key)) current = current[Number(key)];
    else if (typeof current === "object" && current !== null && !Array.isArray(current) && Object.hasOwn(current, key)) current = (current as Record<string, unknown>)[key];
    else return undefined;
  }
  return current;
}

const scalar = (value: unknown): string | undefined =>
  typeof value === "string" ? value : typeof value === "number" || typeof value === "boolean" ? String(value) : value === null ? "null" : undefined;

/** Whether a body passes a trigger's filter; no filter passes everything. */
export function matchesWebhook(match: WebhookTriggerMatch | undefined, body: HookBody): boolean {
  if (!match) return true;
  if (body.kind === "text") {
    if (match.field) return false;
    return match.op === "equals" ? body.value.trim() === match.value : body.value.includes(match.value);
  }
  return matchesJson(match, body.value);
}

/** Whether a JSON value passes a match: what is at `field` (`""`, the whole value) equals `value`, or contains it. */
export function matchesJson(match: WebhookTriggerMatch, value: unknown): boolean {
  const target = match.field ? fieldAt(value, match.field) : value;
  if (target === undefined) return false;
  if (match.op === "equals") return scalar(target) === match.value;
  if (typeof target === "string") return target.includes(match.value);
  if (Array.isArray(target)) return target.some((item) => scalar(item) === match.value);
  return !match.field && JSON.stringify(target).includes(match.value);
}

export const oneLine = (value: string, max: number) => {
  const line = value.replace(/\s+/gu, " ").trim();
  return line.length <= max ? line : `${line.slice(0, max - 1).trimEnd()}…`;
};

/** What a delivery says about a call: a one-line summary (a title, message or action the body carries) and the body
 * itself, pretty-printed and cut to `BOT_TRIGGER_LIMITS.details`. */
export function webhookEvent(body: HookBody): { summary: string; details: string } {
  let hint = "";
  if (body.kind === "json" && typeof body.value === "object" && body.value !== null && !Array.isArray(body.value)) {
    for (const key of ["title", "message", "text", "summary", "action", "event", "type", "status"]) {
      const value = (body.value as Record<string, unknown>)[key];
      if (typeof value === "string" && value.trim()) {
        hint = `${key}: ${oneLine(value, 80)}`;
        break;
      }
    }
  } else if (body.kind === "text" && body.value.trim()) {
    hint = oneLine(body.value.split("\n").find((line) => line.trim()) ?? "", 80);
  }
  const printed = body.kind === "json" ? JSON.stringify(body.value, null, 2) ?? "null" : body.value.trim();
  const limit = BOT_TRIGGER_LIMITS.details - 80;
  const shown = printed.length > limit ? `${printed.slice(0, limit)}\n… (${printed.length - limit} more characters)` : printed;
  return {
    summary: hint ? `webhook call (${hint})` : "webhook call",
    details: [`A ${body.type} body of ${body.bytes} bytes:`, shown || "(empty)"].join("\n"),
  };
}
