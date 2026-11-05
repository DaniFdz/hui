/**
 * A gateway extension's declared shape: its id grammar, `extension.json` manifest, entry path containment, route
 * table and result limits. Pure parsing and validation only — the service owns the filesystem, imports and state, so
 * every rule here is testable without touching a module.
 */
import { resolve, sep } from "node:path";

import type { ExtensionRouteInfo } from "../api/extensions.ts";

export const EXTENSION_ID = /^[a-z][a-z0-9-]{0,31}$/u;
export const EXTENSION_API_VERSION = 1;
export const EXTENSION_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
export type ExtensionMethod = (typeof EXTENSION_METHODS)[number];
export const MAX_EXTENSION_ROUTES = 32;
export const MAX_ROUTE_SEGMENTS = 4;
export const MAX_SEGMENT_CHARS = 64;
export const MAX_DESCRIPTION_CHARS = 240;
export const MAX_NAME_CHARS = 80;
export const MAX_ERROR_CHARS = 500;
export const MAX_RESPONSE_BYTES = 256 * 1024;
export const MAX_EXTENSION_DIRECTORIES = 200;

const SEGMENT = /^[A-Za-z0-9._~-]+$/u;
const CONTROL = /[\p{Cc}]/u;

/** What Settings and the Work pane need to open an extension's panel: its title and the entry page inside `ui/`. */
export type ExtensionPanel = {
  readonly title: string;
  readonly entry: string;
};

export type ExtensionManifest = {
  readonly apiVersion: typeof EXTENSION_API_VERSION;
  readonly name: string;
  readonly description: string;
  /** Relative to the extension's directory. */
  readonly main: string;
  /** Present when the extension ships a sandboxed panel under `ui/`. */
  readonly ui?: ExtensionPanel;
};

export type ExtensionContext = {
  readonly method: string;
  /** The subpath below `/__hui/ext/<id>/`, as declared. */
  readonly path: string;
  readonly query: URLSearchParams;
  /** The parsed JSON request body, or undefined when the request had none. */
  readonly body: unknown;
  /** Aborts when the browser goes away. */
  readonly signal: AbortSignal;
  readonly extension: string;
};

export type ExtensionResult = { readonly status?: number; readonly body: unknown };
export type ExtensionHandler = (context: ExtensionContext) => ExtensionResult | Promise<ExtensionResult>;

export type ExtensionRoute = {
  readonly method: ExtensionMethod;
  readonly path: string;
  readonly description: string;
  readonly handle: ExtensionHandler;
};

export type Parsed<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string };

function fail<T>(error: string): Parsed<T> {
  return { ok: false, error: error.slice(0, MAX_ERROR_CHARS) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedText(value: unknown, maximum: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  if (!text || text.length > maximum || CONTROL.test(text)) return undefined;
  return text;
}

/** The id is the extension's directory name. */
export function extensionId(value: string): string | undefined {
  return EXTENSION_ID.test(value) ? value : undefined;
}

export function parseManifest(raw: unknown): Parsed<ExtensionManifest> {
  if (!isRecord(raw)) return fail("extension.json must be a JSON object");
  if (raw["apiVersion"] !== EXTENSION_API_VERSION) {
    const printed = raw["apiVersion"] === undefined ? "missing" : JSON.stringify(raw["apiVersion"]);
    return fail(`unsupported apiVersion: ${printed}`);
  }
  const name = boundedText(raw["name"], MAX_NAME_CHARS);
  if (!name) return fail(`name must be 1-${MAX_NAME_CHARS} characters without control characters`);
  const rawDescription = raw["description"] ?? "";
  if (typeof rawDescription !== "string" || rawDescription.length > MAX_DESCRIPTION_CHARS || CONTROL.test(rawDescription)) {
    return fail(`description must be at most ${MAX_DESCRIPTION_CHARS} characters without control characters`);
  }
  const main = raw["main"];
  if (typeof main !== "string" || !/\.(?:mjs|js)$/u.test(main)) return fail("main must be a relative .mjs or .js file");
  if (main.startsWith("/") || /^[A-Za-z]:[\\/]/u.test(main)) return fail("main must be relative to the extension directory");
  if (main.split("/").some((segment) => segment === "" || segment === "." || segment === "..")) {
    return fail("main must stay inside the extension directory");
  }
  let ui: ExtensionPanel | undefined;
  if (raw["ui"] !== undefined) {
    if (!isRecord(raw["ui"])) return fail("ui must be an object");
    const title = boundedText(raw["ui"]["title"], MAX_NAME_CHARS);
    if (!title) return fail(`ui.title must be 1-${MAX_NAME_CHARS} characters without control characters`);
    const entry = raw["ui"]["entry"] ?? "index.html";
    if (typeof entry !== "string" || entry.length > 256 || !entry.endsWith(".html")) {
      return fail("ui.entry must be a relative .html file inside the ui directory");
    }
    if (entry.startsWith("/") || /^[A-Za-z]:[\\/]/u.test(entry) || entry.split("/").some((segment) => segment === "" || segment === "." || segment === "..")) {
      return fail("ui.entry must stay inside the ui directory");
    }
    ui = { title, entry };
  }
  return {
    ok: true,
    value: {
      apiVersion: EXTENSION_API_VERSION,
      name,
      description: rawDescription.trim(),
      main,
      ...(ui ? { ui } : {}),
    },
  };
}

/** The entry module's absolute path, or undefined when `main` would leave `directory` lexically. */
export function entryPath(directory: string, main: string): string | undefined {
  const root = resolve(directory);
  const entry = resolve(root, main);
  return entry.startsWith(`${root}${sep}`) ? entry : undefined;
}

function routeSegments(path: string): string[] | undefined {
  const segments = path.split("/");
  if (segments.length < 1 || segments.length > MAX_ROUTE_SEGMENTS) return undefined;
  for (const segment of segments) {
    if (segment.length > MAX_SEGMENT_CHARS || !SEGMENT.test(segment) || segment === "." || segment === "..") return undefined;
  }
  return segments;
}

/** The module's `routes` export, validated; the first problem names the route it came from. */
export function parseRoutes(raw: unknown): Parsed<ExtensionRoute[]> {
  if (!Array.isArray(raw) || raw.length === 0) return fail("routes must be a non-empty array");
  if (raw.length > MAX_EXTENSION_ROUTES) return fail(`routes must hold at most ${MAX_EXTENSION_ROUTES} entries`);
  const routes: ExtensionRoute[] = [];
  const seen = new Set<string>();
  for (const [index, value] of raw.entries()) {
    const where = `routes[${index}]`;
    if (!isRecord(value)) return fail(`${where} must be an object`);
    const method = value["method"];
    if (typeof method !== "string" || !(EXTENSION_METHODS as readonly string[]).includes(method)) {
      return fail(`${where}.method must be one of ${EXTENSION_METHODS.join(", ")}`);
    }
    const path = value["path"];
    if (typeof path !== "string" || !routeSegments(path)) {
      return fail(`${where}.path must be 1-${MAX_ROUTE_SEGMENTS} clean segments of at most ${MAX_SEGMENT_CHARS} characters`);
    }
    const rawDescription = value["description"] ?? "";
    if (typeof rawDescription !== "string" || rawDescription.length > MAX_DESCRIPTION_CHARS || CONTROL.test(rawDescription)) {
      return fail(`${where}.description must be at most ${MAX_DESCRIPTION_CHARS} characters without control characters`);
    }
    if (typeof value["handle"] !== "function") return fail(`${where}.handle must be a function`);
    const key = `${method} ${path}`;
    if (seen.has(key)) return fail(`${where} repeats ${key}`);
    seen.add(key);
    routes.push({
      method: method as ExtensionMethod,
      path,
      description: rawDescription.trim(),
      handle: value["handle"] as ExtensionHandler,
    });
  }
  return { ok: true, value: routes };
}

/** What a handler returned, bounded: a status an HTTP client can use and a JSON object no larger than the limit. */
export function checkedResult(raw: unknown): Parsed<{ status: number; body: Record<string, unknown> }> {
  if (!isRecord(raw)) return fail("handle must return { status?, body }");
  const status = raw["status"] ?? 200;
  if (typeof status !== "number" || !Number.isInteger(status) || status < 100 || status > 599) {
    return fail("status must be an integer from 100 to 599");
  }
  const body = raw["body"];
  if (!isRecord(body)) return fail("body must be a JSON object");
  let serialized: string;
  try {
    serialized = JSON.stringify(body);
  } catch {
    return fail("body must be JSON-serializable");
  }
  if (Buffer.byteLength(serialized, "utf8") > MAX_RESPONSE_BYTES) {
    return fail(`body must serialize to at most ${MAX_RESPONSE_BYTES} bytes`);
  }
  return { ok: true, value: { status, body } };
}

export function routeInfo(routes: readonly ExtensionRoute[]): ExtensionRouteInfo[] {
  return routes.map((route) => ({ method: route.method, path: route.path, description: route.description }));
}

export function routeKey(method: string, path: string): string {
  return `${method} ${path}`;
}
