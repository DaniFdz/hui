/**
 * `GET /__hui/tool-icons/:file`: the user's own mark for a CLI or tool, read from `<config>/tool-icons/`. An `<img>`
 * cannot send `x-hui`, so `hui.ts` dispatches here before its guard and this route accepts that header or a
 * browser-attested same-origin load, refusing everything cross-site. Only flat file names of a known image type are
 * served; SVG is delivered as an image document with its own sandbox, never as a page.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { CLIENT_HEADER, type RouteRequest, type RouteResult } from "../http/route.ts";
import type { RouteSchema } from "../api/index.ts";

export const routeSchemas: RouteSchema[] = [];

export const TOOL_ICON_ROUTE = /^\/__hui\/tool-icons\/([A-Za-z0-9][A-Za-z0-9._-]{0,119})$/u;

const ICON_MIME: Record<string, string> = {
  svg: "image/svg+xml",
  png: "image/png",
  webp: "image/webp",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
};

export function createToolIconRoutes(deps: { directory: string }) {
  async function handle(request: RouteRequest): Promise<RouteResult | undefined> {
    const match = TOOL_ICON_ROUTE.exec(request.path);
    if (!match) return undefined;
    const site = request.headers["sec-fetch-site"];
    if (request.headers[CLIENT_HEADER] !== "1" && site !== "same-origin") {
      return { status: 403, body: { error: `missing ${CLIENT_HEADER} header` } };
    }
    if (request.method !== "GET") return { status: 405, body: { error: "method not allowed" } };
    const name = match[1]!;
    const extension = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
    const mimeType = ICON_MIME[extension];
    if (!mimeType || !name.includes(".")) return { status: 404, body: { error: "unsupported icon type" } };
    try {
      const data = await readFile(join(deps.directory, name));
      return {
        status: 200,
        file: {
          mimeType,
          data,
          headers: {
            "cache-control": "private, max-age=60",
            "cross-origin-resource-policy": "same-origin",
            "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
            "x-content-type-options": "nosniff",
          },
        },
      };
    } catch {
      return { status: 404, body: { error: "icon not found" } };
    }
  }

  return { handle };
}
