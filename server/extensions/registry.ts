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
export const MAX_PROMPT_SECTIONS = 16;
export const MAX_PROMPT_CHARS = 4_000;
export const MAX_PROMPT_TOTAL_CHARS = 16_000;
export const MAX_EXTENSION_TOOLS = 16;
export const MAX_TOOL_DESCRIPTION_CHARS = 500;
export const MAX_TOOL_SNIPPET_CHARS = 200;
export const MAX_TOOL_GUIDELINES = 8;
export const MAX_TOOL_GUIDELINE_CHARS = 200;
export const MAX_SCHEMA_DEPTH = 8;
const TOOL_NAME = /^[a-z][a-z0-9_]{0,47}$/u;
const PROMPT_ID = /^[a-z][a-z0-9-]{0,31}$/u;
const SCHEMA_KEYS = new Set(["type", "description", "properties", "required", "items", "enum", "additionalProperties"]);
const SCHEMA_TYPES = new Set(["object", "string", "number", "integer", "boolean", "array"]);

const SEGMENT = /^[A-Za-z0-9._~-]+$/u;
const CONTROL = /[\p{Cc}]/u;

/** What Settings and the Work pane need to open an extension's panel: its title and the entry page inside `ui/`. */
export type ExtensionPanel = {
  readonly title: string;
  readonly entry: string;
};

/** One static prompt section an extension adds to Durable sessions. */
export type ExtensionPromptSection = {
  readonly id: string;
  readonly title: string;
  readonly text: string;
};

export type ExtensionToolContext = {
  readonly conversationId: string;
  readonly signal: AbortSignal;
};

/** A tool's answer: text, or text with details for the transcript. */
export type ExtensionToolResult = string | { readonly text: string; readonly details?: unknown };
export type ExtensionToolHandler = (args: unknown, context: ExtensionToolContext) => ExtensionToolResult | Promise<ExtensionToolResult>;

/** A tool declared in `extension.json`; its handler is exported by the entry module under the same name. */
export type ExtensionToolDeclaration = {
  /** Without the `ext_<id>_` prefix, which the host adds. */
  readonly name: string;
  readonly description: string;
  /** A JSON Schema object for the arguments, in the supported subset. */
  readonly parameters: Record<string, unknown>;
  readonly promptSnippet?: string;
  readonly promptGuidelines?: readonly string[];
};

export type ExtensionTool = ExtensionToolDeclaration & { readonly handle: ExtensionToolHandler };

export type ExtensionManifest = {
  readonly apiVersion: typeof EXTENSION_API_VERSION;
  readonly name: string;
  readonly description: string;
  /** Relative to the extension's directory. */
  readonly main: string;
  /** Present when the extension ships a sandboxed panel under `ui/`. */
  readonly ui?: ExtensionPanel;
  /** Static prompt sections for Durable sessions. */
  readonly prompt?: readonly ExtensionPromptSection[];
  /** Agent tools for Durable sessions; their handlers come from the entry module. */
  readonly tools?: readonly ExtensionToolDeclaration[];
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

function schemaProblem(value: unknown, depth: number, root = false): string | undefined {
  if (depth > MAX_SCHEMA_DEPTH) return "parameters are nested too deeply";
  if (!isRecord(value)) return "each schema entry must be an object";
  for (const key of Object.keys(value)) if (!SCHEMA_KEYS.has(key)) return `unsupported schema key: ${key}`;
  const type = value["type"];
  if (root && type !== "object") return "parameters must be an object schema";
  if (typeof type !== "string" || !SCHEMA_TYPES.has(type)) return `unsupported schema type: ${String(type)}`;
  if (value["description"] !== undefined && typeof value["description"] !== "string") return "description must be a string";
  if (type === "object") {
    const properties = value["properties"] ?? {};
    if (!isRecord(properties)) return "properties must be an object";
    for (const [name, child] of Object.entries(properties)) {
      if (!TOOL_NAME.test(name)) return `unsupported property name: ${name}`;
      const problem = schemaProblem(child, depth + 1);
      if (problem) return problem;
    }
    const required = value["required"];
    if (required !== undefined && (!Array.isArray(required) || required.some((entry) => typeof entry !== "string" || !(entry in properties)))) {
      return "required must name defined properties";
    }
    if (value["additionalProperties"] !== undefined && typeof value["additionalProperties"] !== "boolean") {
      return "additionalProperties must be a boolean";
    }
    return undefined;
  }
  if (type === "array") return schemaProblem(value["items"], depth + 1);
  if (value["enum"] !== undefined) {
    const values = value["enum"];
    if (!Array.isArray(values) || values.length === 0 || values.some((entry) => !["string", "number", "boolean"].includes(typeof entry))) {
      return "enum must hold string, number or boolean literals";
    }
  }
  return undefined;
}

function parsePrompt(raw: unknown): Parsed<readonly ExtensionPromptSection[]> {
  if (!Array.isArray(raw) || raw.length > MAX_PROMPT_SECTIONS) return fail(`prompt must be an array of at most ${MAX_PROMPT_SECTIONS} sections`);
  const sections: ExtensionPromptSection[] = [];
  const ids = new Set<string>();
  let total = 0;
  for (const [index, value] of raw.entries()) {
    const where = `prompt[${index}]`;
    if (!isRecord(value)) return fail(`${where} must be an object`);
    const id = value["id"];
    if (typeof id !== "string" || !PROMPT_ID.test(id)) return fail(`${where}.id must be a lowercase id`);
    if (ids.has(id)) return fail(`${where}.id is used twice`);
    ids.add(id);
    const title = boundedText(value["title"], MAX_NAME_CHARS);
    if (!title) return fail(`${where}.title must be 1-${MAX_NAME_CHARS} characters without control characters`);
    const text = value["text"];
    if (typeof text !== "string" || text.length === 0 || text.length > MAX_PROMPT_CHARS || CONTROL.test(text.replaceAll("\n", "").replaceAll("\t", ""))) {
      return fail(`${where}.text must be 1-${MAX_PROMPT_CHARS} characters of text`);
    }
    total += text.length;
    sections.push({ id, title, text });
  }
  if (total > MAX_PROMPT_TOTAL_CHARS) return fail(`prompt must stay within ${MAX_PROMPT_TOTAL_CHARS} characters`);
  return { ok: true, value: sections };
}

function parseTools(raw: unknown): Parsed<readonly ExtensionToolDeclaration[]> {
  if (!Array.isArray(raw) || raw.length > MAX_EXTENSION_TOOLS) return fail(`tools must be an array of at most ${MAX_EXTENSION_TOOLS} tools`);
  const tools: ExtensionToolDeclaration[] = [];
  const names = new Set<string>();
  for (const [index, value] of raw.entries()) {
    const where = `tools[${index}]`;
    if (!isRecord(value)) return fail(`${where} must be an object`);
    const name = value["name"];
    if (typeof name !== "string" || !TOOL_NAME.test(name)) return fail(`${where}.name must match the tool-name grammar`);
    if (names.has(name)) return fail(`${where}.name is used twice`);
    names.add(name);
    const description = boundedText(value["description"], MAX_TOOL_DESCRIPTION_CHARS);
    if (!description) return fail(`${where}.description must be 1-${MAX_TOOL_DESCRIPTION_CHARS} characters`);
    const parameters = value["parameters"];
    const problem = schemaProblem(parameters, 1, true);
    if (problem) return fail(`${where}.parameters: ${problem}`);
    const rawSnippet = value["promptSnippet"];
    const promptSnippet = rawSnippet === undefined ? undefined : boundedText(rawSnippet, MAX_TOOL_SNIPPET_CHARS);
    if (rawSnippet !== undefined && !promptSnippet) return fail(`${where}.promptSnippet must be at most ${MAX_TOOL_SNIPPET_CHARS} characters`);
    const rawGuidelines = value["promptGuidelines"];
    if (rawGuidelines !== undefined && (!Array.isArray(rawGuidelines) || rawGuidelines.length > MAX_TOOL_GUIDELINES || rawGuidelines.some((line) => typeof line !== "string" || line.length === 0 || line.length > MAX_TOOL_GUIDELINE_CHARS))) {
      return fail(`${where}.promptGuidelines must be at most ${MAX_TOOL_GUIDELINES} lines of at most ${MAX_TOOL_GUIDELINE_CHARS} characters`);
    }
    tools.push({
      name,
      description,
      parameters: parameters as Record<string, unknown>,
      ...(promptSnippet ? { promptSnippet } : {}),
      ...(rawGuidelines ? { promptGuidelines: (rawGuidelines as string[]).map((line) => line.trim()) } : {}),
    });
  }
  return { ok: true, value: tools };
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
  let prompt: Parsed<readonly ExtensionPromptSection[]> | undefined;
  if (raw["prompt"] !== undefined) {
    prompt = parsePrompt(raw["prompt"]);
    if (!prompt.ok) return prompt;
  }
  let toolList: Parsed<readonly ExtensionToolDeclaration[]> | undefined;
  if (raw["tools"] !== undefined) {
    toolList = parseTools(raw["tools"]);
    if (!toolList.ok) return toolList;
  }
  return {
    ok: true,
    value: {
      apiVersion: EXTENSION_API_VERSION,
      name,
      description: rawDescription.trim(),
      main,
      ...(ui ? { ui } : {}),
      ...(prompt?.ok ? { prompt: prompt.value } : {}),
      ...(toolList?.ok ? { tools: toolList.value } : {}),
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
