/**
 * The child process of one out-of-process gateway extension. It reads `EXT ` frames on stdin, imports the extension's
 * entry module in this process, and answers call/stream/cancel frames until stopped. A crash here takes only this
 * process down; the gateway's supervisor restarts it. Tools are in-process only and are refused before this process
 * starts.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createInterface } from "node:readline";

import { checkedResult, checkedStream, entryPath, parseManifest, parseRoutes, type ExtensionGatewayContext, type ExtensionRoute } from "./registry.ts";
import {
  CALL_TIMEOUT_MS, EXTENSION_PROTOCOL_VERSION, decodeFrame, encodeFrame, type HostFrame, type ParentFrame,
} from "./protocol.ts";

const directory = process.argv[2] ?? "";
if (!directory) {
  process.stdout.write(encodeFrame({ t: "failed", error: "the extension directory is missing" }));
  process.exit(2);
}

function send(frame: HostFrame): void {
  process.stdout.write(encodeFrame(frame));
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

let routes: readonly ExtensionRoute[] = [];
let nextContextId = 1;
const contextPending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();

/** Ask the supervising gateway for one context capability; the parent answers on this stdin. */
function callContext(capability: string, args: unknown, signal: AbortSignal): Promise<unknown> {
  const id = nextContextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      contextPending.delete(id);
      reject(new Error("the gateway context call timed out"));
    }, CALL_TIMEOUT_MS);
    const abort = () => {
      clearTimeout(timer);
      contextPending.delete(id);
      reject(new Error("the gateway context call was cancelled"));
    };
    signal.addEventListener("abort", abort, { once: true });
    contextPending.set(id, {
      resolve: (value) => { clearTimeout(timer); signal.removeEventListener("abort", abort); resolve(value); },
      reject: (error) => { clearTimeout(timer); signal.removeEventListener("abort", abort); reject(error); },
      timer,
    });
    send({ t: "context", id, capability, args });
  });
}

function processContext(signal: AbortSignal): ExtensionGatewayContext {
  return {
    github: {
      contributions: async (year) => await callContext("github.contributions", { year }, signal),
    },
  };
}

async function main(): Promise<void> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(join(directory, "extension.json"), "utf8"));
  } catch (error) {
    send({ t: "failed", error: `extension.json could not be read: ${message(error)}` });
    process.exit(1);
  }
  const manifest = parseManifest(raw);
  if (!manifest.ok) {
    send({ t: "failed", error: manifest.error });
    process.exit(1);
  }
  if (manifest.value.tools?.length) {
    send({ t: "failed", error: "tools require in-process mode" });
    process.exit(1);
  }
  const entry = entryPath(directory, manifest.value.main);
  if (!entry) {
    send({ t: "failed", error: "main must stay inside the extension directory" });
    process.exit(1);
  }
  let module: unknown;
  try {
    module = await import(pathToFileURL(entry).href);
  } catch (error) {
    send({ t: "failed", error: `entry module threw on import: ${message(error)}` });
    process.exit(1);
  }
  const parsed = parseRoutes((module as { routes?: unknown } | null)?.routes);
  if (!parsed.ok) {
    send({ t: "failed", error: parsed.error });
    process.exit(1);
  }
  routes = parsed.value;
  send({
    t: "ready",
    protocol: EXTENSION_PROTOCOL_VERSION,
    apiVersion: manifest.value.apiVersion,
    routes: routes.map((route) => ({ method: route.method, path: route.path, description: route.description, stream: route.stream })),
    ...(manifest.value.prompt ? { prompt: manifest.value.prompt.map((section) => ({ id: section.id, title: section.title, text: section.text })) } : {}),
  });
}

function routeFor(method: string, path: string): ExtensionRoute | undefined {
  return routes.find((route) => route.method === method && route.path === path);
}

async function call(frame: Extract<ParentFrame, { t: "call" | "stream" }>, signal: AbortSignal): Promise<void> {
  const question = frame.path.indexOf("?");
  const path = question < 0 ? frame.path : frame.path.slice(0, question);
  const route = routeFor(frame.method, path);
  if (!route) {
    send({ t: "error", id: frame.id, error: `unknown extension route: ${path}` });
    return;
  }
  if ((frame.t === "stream") !== route.stream) {
    send({ t: "error", id: frame.id, error: "the route and the call disagree about streaming" });
    return;
  }
  const url = new URL(`http://extension/${frame.path}`);
  let result: unknown;
  try {
    result = await route.handle({
      method: frame.method,
      path,
      query: question < 0 ? new URLSearchParams() : url.searchParams,
      body: frame.body,
      signal,
      extension: "process",
      hui: processContext(signal),
    });
  } catch (error) {
    send({ t: "error", id: frame.id, error: message(error) });
    return;
  }
  if (route.stream) {
    const events = checkedStream(result);
    if (!events.ok) {
      send({ t: "error", id: frame.id, error: events.error });
      return;
    }
    try {
      for await (const event of events.value) {
        if (signal.aborted) break;
        send({ t: "event", id: frame.id, event });
      }
      send({ t: "end", id: frame.id });
    } catch (error) {
      send({ t: "error", id: frame.id, error: message(error) });
    }
    return;
  }
  const checked = checkedResult(result);
  if (!checked.ok) {
    send({ t: "error", id: frame.id, error: checked.error });
    return;
  }
  send({ t: "result", id: frame.id, status: checked.value.status, body: checked.value.body });
}

const controllers = new Map<number, AbortController>();
createInterface({ input: process.stdin }).on("line", (line) => {
  const frame = decodeFrame(line);
  if (!frame || !("t" in frame)) return;
  if (frame.t === "context-result") {
    const pending = contextPending.get(frame.id);
    if (!pending) return;
    contextPending.delete(frame.id);
    if (frame.error !== undefined) pending.reject(new Error(frame.error));
    else pending.resolve(frame.value);
    return;
  }
  if (frame.t === "stop") process.exit(0);
  if (frame.t === "cancel") {
    controllers.get(frame.id)?.abort();
    return;
  }
  if (frame.t === "call" || frame.t === "stream") {
    const controller = new AbortController();
    controllers.set(frame.id, controller);
    const timer = setTimeout(() => controller.abort(), CALL_TIMEOUT_MS);
    void call(frame, controller.signal).finally(() => {
      clearTimeout(timer);
      controllers.delete(frame.id);
    });
  }
});

void main();
