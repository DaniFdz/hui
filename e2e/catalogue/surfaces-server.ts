/**
 * Collects the gateway's user-facing surfaces as `kind:key` strings for the use-case catalogue: the tools agents and
 * bots get (bots' tool switches included), and the `/__hui/` routes, from the published schema plus the routes only `docs/api.md` documents (they
 * answer with files, pages or binary data). The browser's surfaces are in `surfaces-src.ts` (rule R12 in docs/map.md).
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { shippedTools } from "../../server/runtimes/tool-catalog.ts";
import { BOT_ALWAYS_ON, BOT_TOOLS, CODING_TOOLS } from "../../server/bots/durable-access.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const read = (path: string) => readFile(join(root, path), "utf8");

/** `METHOD /__hui/…` on one line, ending in a path character so trailing punctuation never becomes part of a route. */
const DOCUMENTED_ROUTE = /\b((?:GET|POST|PUT|PATCH|DELETE|HEAD)(?:\|[A-Z]+)*) (\/__hui\/[A-Za-z0-9_:/.<>-]*[A-Za-z0-9_>])/gu;

export async function gatewaySurfaces(): Promise<string[]> {
  const schema = JSON.parse(await read("docs/api.schema.json")) as { "x-hui-routes": { method: string; path: string }[] };
  const routes = new Set(schema["x-hui-routes"].map(({ method, path }) => `${method} ${path}`));
  for (const line of (await read("docs/api.md")).split("\n")) {
    for (const [, methods, path] of line.matchAll(DOCUMENTED_ROUTE)) {
      for (const method of methods!.split("|")) routes.add(`${method} ${path}`);
    }
  }
  return [
    ...shippedTools().map((tool) => `tool:${tool.name}`),
    ...BOT_ALWAYS_ON.map((tool) => `tool:${tool.name}`),
    ...[...Object.keys(CODING_TOOLS), ...Object.keys(BOT_TOOLS)].map((name) => `tool:${name}`),
    ...[...routes].sort().map((route) => `route:${route}`),
  ];
}
