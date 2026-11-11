/**
 * The panel bridge's rules: the one channel name, the call envelope, the path normalization that keeps a panel inside
 * its own routes, and the limits the parent enforces. A panel's frame is an opaque origin with no network; these
 * helpers decide what it may ask the parent to do.
 */
import type { ExtensionRouteInfo } from "../../api/schema/extensions.ts";

export const BRIDGE_CHANNEL = "hui-extension";
/** A page asks the app to open a HUI route; the app answers only these paths. */
export const EXTENSION_NAVIGATE_EVENT = "hui-extension-navigate";
const SESSION_PATH = /^\/sessions\/([0-9a-f-]{36})$/u;
export const BRIDGE_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
export const BRIDGE_CALL_TIMEOUT_MS = 30_000;
export const BRIDGE_MAX_IN_FLIGHT = 20;
export const BRIDGE_MAX_REQUEST_BYTES = 64 * 1024;
export const BRIDGE_MAX_RESPONSE_BYTES = 256 * 1024;
export const BRIDGE_MAX_PATH_CHARS = 512;
const SEGMENT = /^[A-Za-z0-9._~-]{1,64}$/u;

export type BridgeCall = {
  readonly callId: number;
  readonly method: string;
  readonly path: string;
  /** The route key without a query string, matched against the extension's declared routes. */
  readonly route: string;
  readonly body: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A page may ask to open a conversation, never an arbitrary HUI path or URL. */
export function allowedNavigatePath(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const match = SESSION_PATH.exec(value);
  return match ? `/sessions/${match[1]}` : undefined;
}

/** The bytes a JSON body occupies, or undefined when it cannot be serialized. */
export function jsonBytes(value: unknown): number | undefined {
  if (value === undefined) return 0;
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength;
  } catch {
    return undefined;
  }
}

/** A path inside the extension's namespace, or undefined when it could leave it. */
export function normalizeCallPath(value: unknown): { path: string; route: string } | undefined {
  if (typeof value !== "string" || value.length === 0 || value.length > BRIDGE_MAX_PATH_CHARS) return undefined;
  const question = value.indexOf("?");
  const rawPath = question < 0 ? value : value.slice(0, question);
  const query = question < 0 ? "" : value.slice(question + 1);
  const segments = rawPath.split("/");
  if (segments.length === 0 || segments.length > 4) return undefined;
  for (const segment of segments) if (!SEGMENT.test(segment) || segment === "." || segment === "..") return undefined;
  return { path: `${segments.map((segment) => encodeURIComponent(segment)).join("/")}${query ? `?${query}` : ""}`, route: segments.join("/") };
}

export function callIsAllowed(routes: readonly ExtensionRouteInfo[], method: string, route: string): boolean {
  return routes.some((candidate) => candidate.method === method && candidate.path === route);
}

/** The parent's answer to one call: a status and a JSON body, or an error. */
export type BridgeAnswer = { status: number; body: unknown } | { error: string };

/** Validates one `call` message from a panel and resolves it against that extension's active routes. */
export function parseBridgeCall(value: unknown, routes: readonly ExtensionRouteInfo[]): { call: BridgeCall } | { error: string; callId?: number } {
  if (!isRecord(value) || value["channel"] !== BRIDGE_CHANNEL || value["type"] !== "call") return { error: "not a call" };
  const callId = value["callId"];
  if (typeof callId !== "number" || !Number.isInteger(callId) || callId <= 0) return { error: "bad call id" };
  const method = value["method"];
  if (typeof method !== "string" || !(BRIDGE_METHODS as readonly string[]).includes(method)) return { error: "method not allowed", callId };
  const normalized = normalizeCallPath(value["path"]);
  if (!normalized) return { error: "path not allowed", callId };
  if (!callIsAllowed(routes, method, normalized.route)) return { error: "route not allowed", callId };
  const bytes = jsonBytes(value["body"]);
  if (bytes === undefined) return { error: "body is not JSON", callId };
  if (bytes > BRIDGE_MAX_REQUEST_BYTES) return { error: "request too large", callId };
  return { call: { callId, method, path: normalized.path, route: normalized.route, body: value["body"] } };
}
