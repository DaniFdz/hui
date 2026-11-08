/**
 * Gateway extensions at runtime: scan `<CONFIG_DIR>/extensions`, import the enabled ones, keep their route tables and
 * answer the status/toggle surface. A module runs in the gateway process with the gateway's access — trusted code, no
 * sandbox — so every failure is contained to that extension: a named error in its status, one diagnostic, and no
 * effect on any other route. Enablement is `extensions.json` (store.ts); nothing here writes it but `setEnabled`.
 */
import { readFileSync } from "node:fs";
import { readFile, readdir, realpath, stat } from "node:fs/promises";
import { findPackageJSON } from "node:module";
import { join, sep } from "node:path";
import { pathToFileURL } from "node:url";

import type { ExtensionRouteInfo, ExtensionStatus, ExtensionsResponse } from "../api/extensions.ts";
import type { JsonResult, RouteRequest, RouteResult } from "../http/route.ts";
import { EXTENSIONS_DIR, EXTENSIONS_FILE } from "../paths.ts";
import { ExtensionHost, HostUnavailableError } from "./host.ts";
import { MAX_PROCESS_EXTENSIONS } from "./protocol.ts";
import { recordDiagnosticEvent } from "../observability.ts";
import {
  checkedResult, checkedStream, entryPath, extensionId, MAX_EXTENSION_DIRECTORIES, MAX_ERROR_CHARS, parseManifest, parseRoutes, satisfiesEngines,
  routeInfo, routeKey, type ExtensionGatewayContext, type ExtensionManifest, type ExtensionRoute, type ExtensionTool, type ExtensionToolHandler,
} from "./registry.ts";
import { readExtensions, writeExtensions } from "./store.ts";

export class UnknownExtensionError extends Error {
  readonly extensionId: string;

  constructor(extensionId: string) {
    super(`unknown extension: ${extensionId}`);
    this.extensionId = extensionId;
    this.name = "UnknownExtensionError";
  }
}

type Loaded = {
  readonly id: string;
  readonly manifest: ExtensionManifest;
  readonly tools: readonly ExtensionTool[];
  /** Set for a `mode: "process"` extension: its routes, prompt text and answers come from this child. */
  readonly host?: ExtensionHost;
  readonly routes: readonly ExtensionRoute[];
  readonly byKey: ReadonlyMap<string, ExtensionRoute>;
  readonly paths: ReadonlySet<string>;
  readonly info: readonly ExtensionRouteInfo[];
};

type RecordEvent = typeof recordDiagnosticEvent;

export type ExtensionsServiceOptions = {
  dir?: string;
  file?: string;
  record?: RecordEvent;
  /** The running HUI version `engines.hui` is checked against; read from package.json by default. */
  huiVersion?: string;
};

function packageVersion(): string {
  const manifest = findPackageJSON(import.meta.url);
  if (!manifest) return "0.0.0";
  try {
    const parsed = JSON.parse(readFileSync(manifest, "utf8")) as { version?: unknown };
    return typeof parsed.version === "string" ? parsed.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function engineRange(engines: { min?: string; max?: string }): string {
  return [engines.min ? `>=${engines.min}` : "", engines.max ? `<=${engines.max}` : ""].filter(Boolean).join(" ") || "any";
}

/** One tool an enabled extension offers a Durable conversation, with its runtime name. */
export type ExtensionAgentTool = {
  readonly extensionId: string;
  readonly name: string;
  readonly tool: ExtensionTool;
};

export type ExtensionAgentContribution = { readonly snippet: string; readonly guidelines: readonly string[] };

export type InvokeInput = {
  readonly id: string;
  readonly method: string;
  readonly subpath: string;
  readonly request: RouteRequest;
};

export type ExtensionsService = {
  list(): Promise<ExtensionsResponse>;
  setEnabled(id: string, enabled: boolean): Promise<ExtensionStatus>;
  /** Re-imports one extension's module now; a failed reload withdraws its routes and reports `failed`. */
  reload(id: string): Promise<ExtensionStatus>;
  /** Stops every process-mode host; the gateway calls it on shutdown. */
  stop(): Promise<void>;
  reconcile(): Promise<void>;
  invoke(input: InvokeInput): Promise<RouteResult>;
  /** The `ui/` directory of a loaded extension that ships a panel, for the pre-gate asset route. */
  panelRoot(id: string): Promise<string | undefined>;
  /** The static prompt text every enabled extension contributes, or undefined when none does. */
  promptText(): string | undefined;
  /** The tools every enabled extension offers a new Durable conversation. */
  agentTools(): readonly ExtensionAgentTool[];
  /** The prompt snippet and guidelines of each agent tool, by runtime name. */
  contributions(): Readonly<Record<string, ExtensionAgentContribution>>;
  /** The tool a conversation may call, looked up at call time so a disabled extension answers nothing. */
  toolFor(extensionId: string, name: string): ExtensionTool | undefined;
  /** The gateway data routes may read; set after the services it reads exist. */
  setGatewayContext(context: ExtensionGatewayContext): void;
};

function message(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return (text.split("\n")[0] ?? text).slice(0, MAX_ERROR_CHARS);
}

export function createExtensionsService(options: ExtensionsServiceOptions = {}): ExtensionsService {
  const dir = options.dir ?? EXTENSIONS_DIR;
  const file = options.file ?? EXTENSIONS_FILE;
  const record = options.record ?? recordDiagnosticEvent;
  const huiVersion = options.huiVersion ?? packageVersion();
  const loaded = new Map<string, Loaded>();
  const reloadedAt = new Map<string, number>();
  const failures = new Map<string, string>();
  let gatewayContext: ExtensionGatewayContext | undefined;
  let chain: Promise<void> = Promise.resolve();

  async function scan(): Promise<Map<string, string>> {
    const found = new Map<string, string>();
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return found;
    }
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (found.size >= MAX_EXTENSION_DIRECTORIES) break;
      if (!entry.isDirectory()) continue;
      const id = extensionId(entry.name);
      if (!id) continue;
      found.set(id, join(dir, entry.name));
    }
    return found;
  }

  async function readManifest(directory: string): Promise<{ manifest: ExtensionManifest } | { error: string }> {
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(join(directory, "extension.json"), "utf8"));
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      return { error: code === "ENOENT" ? "extension.json is missing" : `extension.json could not be read: ${message(error)}` };
    }
    const parsed = parseManifest(raw);
    return parsed.ok ? { manifest: parsed.value } : { error: parsed.error };
  }

  async function load(id: string, directory: string, bust = false): Promise<{ loaded: Loaded } | { error: string }> {
    const read = await readManifest(directory);
    if ("error" in read) return { error: read.error };
    const requires = read.manifest.engines?.hui;
    if (!satisfiesEngines(requires, huiVersion)) {
      return { error: `requires HUI ${requires ? engineRange(requires) : "any"}; this gateway is ${huiVersion}` };
    }
    if (read.manifest.mode === "process") {
      const count = [...loaded.values()].filter((entry) => entry.host !== undefined).length;
      if (count >= MAX_PROCESS_EXTENSIONS) return { error: `at most ${MAX_PROCESS_EXTENSIONS} process-mode extensions can run at once` };
      const host = new ExtensionHost({ id, directory, record });
      const started = await host.start();
      if (!started.ok) {
        await host.stop();
        return { error: started.error };
      }
      return {
        loaded: {
          id,
          manifest: read.manifest,
          tools: [],
          routes: [],
          byKey: new Map(),
          paths: new Set(host.info.routes.map((route) => route.path)),
          info: host.info.routes,
          host,
        },
      };
    }
    const entry = entryPath(directory, read.manifest.main);
    if (!entry) return { error: "main must stay inside the extension directory" };
    let entryPathReal: string;
    try {
      const root = await realpath(directory);
      entryPathReal = await realpath(entry);
      if (!entryPathReal.startsWith(`${root}${sep}`)) return { error: "main must stay inside the extension directory" };
    } catch (error) {
      return { error: `entry module is missing: ${message(error)}` };
    }
    let module: unknown;
    try {
      module = await import(pathToFileURL(entryPathReal).href + (bust ? `?reload=${Date.now()}` : ""));
    } catch (error) {
      return { error: `entry module threw on import: ${message(error)}` };
    }
    const routes = parseRoutes((module as { routes?: unknown } | null)?.routes);
    if (!routes.ok) return { error: routes.error };
    const declared = read.manifest.tools ?? [];
    const exported = (module as { tools?: unknown } | null)?.tools;
    if (exported !== undefined && (typeof exported !== "object" || exported === null || Array.isArray(exported))) {
      return { error: "tools must be an object of handlers" };
    }
    const handlers = (exported ?? {}) as Record<string, unknown>;
    const tools: ExtensionTool[] = [];
    for (const tool of declared) {
      const handler = handlers[tool.name];
      if (typeof handler !== "function") return { error: `tools.${tool.name} has no handler exported by the entry module` };
      tools.push({ ...tool, handle: handler as ExtensionToolHandler });
    }
    const byKey = new Map<string, ExtensionRoute>();
    const paths = new Set<string>();
    for (const route of routes.value) {
      byKey.set(routeKey(route.method, route.path), route);
      paths.add(route.path);
    }
    return {
      loaded: {
        id,
        manifest: read.manifest,
        tools,
        routes: routes.value,
        byKey,
        paths,
        info: routeInfo(routes.value),
      },
    };
  }

  function fail(id: string, error: string): void {
    failures.set(id, error);
    loaded.delete(id);
    record({
      area: "gateway",
      level: "warning",
      action: "extension_load_failed",
      summary: `extension ${id} did not load: ${error}`,
    });
  }

  async function reconcileNow(): Promise<void> {
    const store = await readExtensions(file);
    if (store.error) {
      record({
        area: "gateway",
        level: "warning",
        action: "extensions_store_failed",
        summary: store.error,
      });
    }
    const enabled = new Set(store.enabled);
    for (const id of [...loaded.keys()]) {
      if (!enabled.has(id)) {
        await loaded.get(id)?.host?.stop();
        loaded.delete(id);
        failures.delete(id);
      }
    }
    const directories = await scan();
    for (const id of enabled) {
      const directory = directories.get(id);
      if (!directory) {
        fail(id, "no extension directory");
        continue;
      }
      if (loaded.has(id)) continue;
      const result = await load(id, directory);
      if ("error" in result) {
        fail(id, result.error);
        continue;
      }
      loaded.set(id, result.loaded);
      failures.delete(id);
    }
  }

  async function reload(id: string): Promise<ExtensionStatus> {
    if (!extensionId(id)) throw new UnknownExtensionError(id);
    const directory = (await scan()).get(id);
    if (!directory) throw new UnknownExtensionError(id);
    await loaded.get(id)?.host?.stop();
    const result = await load(id, directory, true);
    if ("error" in result) fail(id, result.error);
    else {
      loaded.set(id, result.loaded);
      failures.delete(id);
    }
    reloadedAt.set(id, Date.now());
    const status = (await list()).extensions.find((entry) => entry.id === id);
    if (!status) throw new UnknownExtensionError(id);
    return status;
  }

  async function stop(): Promise<void> {
    await Promise.all([...loaded.values()].map((entry) => entry.host?.stop()));
    loaded.clear();
  }

  async function reconcile(): Promise<void> {
    const run = chain.then(() => reconcileNow());
    chain = run.catch(() => undefined);
    return run;
  }

  async function statusOf(id: string, storeEnabled: ReadonlySet<string>, directories: ReadonlyMap<string, string>): Promise<ExtensionStatus> {
    const enabled = storeEnabled.has(id);
    const directory = directories.get(id);
    const active = loaded.get(id);
    const host = active?.host;
    const base = {
      id,
      enabled,
      routes: [...(active?.info ?? [])],
      mode: host ? ("process" as const) : ("in-process" as const),
      restarts: host?.info.restarts ?? 0,
      ...(reloadedAt.has(id) ? { reloadedAt: reloadedAt.get(id) } : {}),
    };
    if (!directory) {
      return { ...base, name: id, description: "", state: "missing", error: "no extension directory" };
    }
    const read = await readManifest(directory);
    if ("error" in read) return { ...base, name: id, description: "", state: "failed", error: read.error };
    const identity = {
      name: read.manifest.name,
      description: read.manifest.description,
      ...(read.manifest.version ? { version: read.manifest.version } : {}),
      ...(read.manifest.engines?.hui ? { engines: read.manifest.engines.hui } : {}),
      ...(read.manifest.ui ? { panel: { title: read.manifest.ui.title, entry: read.manifest.ui.entry, ...(read.manifest.ui.icon ? { icon: read.manifest.ui.icon } : {}) } } : {}),
      ...(read.manifest.ui?.page ? { page: read.manifest.ui.page } : {}),
      ...(read.manifest.prompt ? { prompt: read.manifest.prompt.map((section) => ({ id: section.id, title: section.title, text: section.text })) } : {}),
      ...(read.manifest.tools ? {
        tools: read.manifest.tools.map((tool) => ({ name: tool.name, runtimeName: runtimeToolName(id, tool.name), description: tool.description })),
      } : {}),
    };
    if (active?.host?.info.state === "failed") return { ...base, ...identity, state: "failed", error: active.host.info.error ?? "the extension process failed" };
    if (active) return { ...base, ...identity, state: "loaded" };
    if (!enabled) return { ...base, ...identity, state: "disabled" };
    return { ...base, ...identity, state: "failed", error: failures.get(id) ?? "not loaded" };
  }

  async function list(): Promise<ExtensionsResponse> {
    const store = await readExtensions(file);
    const directories = await scan();
    const enabled = new Set(store.enabled);
    const ids = [...new Set([...directories.keys(), ...store.enabled, ...loaded.keys()])].sort();
    const statuses: ExtensionStatus[] = [];
    for (const id of ids) statuses.push(await statusOf(id, enabled, directories));
    return { extensions: statuses, ...(store.error ? { storeError: store.error } : {}) };
  }

  async function setEnabled(id: string, enabled: boolean): Promise<ExtensionStatus> {
    if (!extensionId(id)) throw new UnknownExtensionError(id);
    try {
      if (!(await stat(join(dir, id))).isDirectory()) throw new UnknownExtensionError(id);
    } catch (error) {
      if (error instanceof UnknownExtensionError) throw error;
      throw new UnknownExtensionError(id);
    }
    const store = await readExtensions(file);
    const next = new Set(store.enabled);
    if (enabled) next.add(id);
    else next.delete(id);
    await writeExtensions([...next], file);
    await reconcile();
    const status = (await list()).extensions.find((entry) => entry.id === id);
    if (!status) throw new UnknownExtensionError(id);
    return status;
  }

  function unknownRoute(subpath: string): JsonResult {
    return { status: 404, body: { error: `unknown extension route: ${subpath}` } };
  }

  function runtimeToolName(id: string, name: string): string {
    return `ext_${id.replaceAll("-", "_")}_${name}`;
  }

  function promptText(): string | undefined {
    const parts: string[] = [];
    for (const active of [...loaded.values()].sort((left, right) => left.id.localeCompare(right.id))) {
      const sections = active.host ? active.host.info.prompt : active.manifest.prompt;
      if (!sections?.length) continue;
      parts.push(`### Extension: ${active.manifest.name} (${active.id})`);
      for (const section of sections) parts.push(`#### ${section.title}\n${section.text}`);
    }
    return parts.length ? parts.join("\n\n") : undefined;
  }

  function agentTools(): ExtensionAgentTool[] {
    const tools: ExtensionAgentTool[] = [];
    for (const active of [...loaded.values()].sort((left, right) => left.id.localeCompare(right.id))) {
      for (const tool of active.tools) {
        tools.push({ extensionId: active.id, name: runtimeToolName(active.id, tool.name), tool });
      }
    }
    return tools;
  }

  function contributions(): Record<string, ExtensionAgentContribution> {
    const found: Record<string, ExtensionAgentContribution> = {};
    for (const entry of agentTools()) {
      if (!entry.tool.promptSnippet && !entry.tool.promptGuidelines?.length) continue;
      found[entry.name] = { snippet: entry.tool.promptSnippet ?? "", guidelines: entry.tool.promptGuidelines ?? [] };
    }
    return found;
  }

  function toolFor(extensionId: string, name: string): ExtensionTool | undefined {
    return loaded.get(extensionId)?.tools.find((tool) => tool.name === name);
  }

  function setGatewayContext(context: ExtensionGatewayContext): void {
    gatewayContext = context;
  }

  async function panelRoot(id: string): Promise<string | undefined> {
    const active = loaded.get(id);
    return active?.manifest.ui ? join(dir, id, "ui") : undefined;
  }

  async function installed(id: string): Promise<boolean> {
    try {
      return (await stat(join(dir, id))).isDirectory();
    } catch {
      return false;
    }
  }

  async function invoke(input: InvokeInput): Promise<RouteResult> {
    const { id, method, subpath, request } = input;
    const active = loaded.get(id);
    if (!active) {
      if (!await installed(id)) return { status: 404, body: { error: `unknown extension: ${id}` } };
      return unknownRoute(subpath);
    }
    if (active.host) {
      const declared = active.info.find((entry) => entry.method === method && entry.path === subpath);
      if (!declared) {
        return active.paths.has(subpath) ? { status: 405, body: { error: "method not allowed" } } : unknownRoute(subpath);
      }
      let body: unknown;
      if (method !== "GET" && method !== "HEAD") {
        try {
          body = await request.json();
        } catch (error) {
          return message(error) === "request body too large"
            ? { status: 413, body: { error: "request body too large" } }
            : { status: 400, body: { error: "body must be JSON" } };
        }
      }
      try {
        if (declared.stream) {
          return {
            status: 200,
            sse: {
              events: active.host.stream(method, subpath, body, request.signal),
              onError: (reason) => record({
                area: "gateway", level: "error", action: "extension_stream_failed",
                summary: `extension ${id} stream ended: ${reason}`, detail: `${method} ${subpath}`,
              }),
            },
          };
        }
        const answer = await active.host.call(method, subpath, body);
        return { status: answer.status, body: answer.body };
      } catch (error) {
        if (error instanceof HostUnavailableError) return { status: 503, body: { error: "extension process is restarting" } };
        record({
          area: "gateway", level: "error", action: "extension_failed",
          summary: `extension ${id} failed: ${method} ${subpath}`, detail: message(error),
        });
        return { status: 500, body: { error: "extension failed" } };
      }
    }
    const route = active.byKey.get(routeKey(method, subpath));
    if (!route) {
      return active.paths.has(subpath)
        ? { status: 405, body: { error: "method not allowed" } }
        : unknownRoute(subpath);
    }
    let body: unknown;
    if (method !== "GET" && method !== "HEAD") {
      try {
        body = await request.json();
      } catch (error) {
        return message(error) === "request body too large"
          ? { status: 413, body: { error: "request body too large" } }
          : { status: 400, body: { error: "body must be JSON" } };
      }
    }
    let result: unknown;
    try {
      result = await route.handle({
        method, path: subpath, query: request.query, body, signal: request.signal, extension: id,
        hui: gatewayContext ?? {
          github: { contributions: async () => { throw new Error("The HUI gateway context is not available in this process."); } },
        },
      });
    } catch (error) {
      record({
        area: "gateway", level: "error", action: "extension_failed",
        summary: `extension ${id} failed: ${method} ${subpath}`, detail: message(error),
      });
      return { status: 500, body: { error: "extension failed" } };
    }
    if (route.stream) {
      const events = checkedStream(result);
      if (!events.ok) {
        record({
          area: "gateway", level: "error", action: "extension_failed",
          summary: `extension ${id} returned an invalid stream: ${method} ${subpath}`, detail: events.error,
        });
        return { status: 500, body: { error: "extension failed" } };
      }
      return {
        status: 200,
        sse: {
          events: events.value,
          onError: (reason) => record({
            area: "gateway", level: "error", action: "extension_stream_failed",
            summary: `extension ${id} stream ended: ${reason}`, detail: `${method} ${subpath}`,
          }),
        },
      };
    }
    const checked = checkedResult(result);
    if (!checked.ok) {
      record({
        area: "gateway", level: "error", action: "extension_failed",
        summary: `extension ${id} returned an invalid answer: ${method} ${subpath}`, detail: checked.error,
      });
      return { status: 500, body: { error: "extension failed" } };
    }
    return { status: checked.value.status, body: checked.value.body };
  }

  return { list, setEnabled, reload, reconcile, stop, invoke, panelRoot, promptText, agentTools, contributions, toolFor, setGatewayContext };
}
