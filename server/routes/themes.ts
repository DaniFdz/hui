/**
 * `GET /__hui/themes` (the merged theme list) and `POST /__hui/themes/import` (a tweakcn theme into the user's
 * themes), over `themes.ts`. `hui.ts` applies the `x-hui` guard before dispatching here.
 */
import type { JsonResult, RouteRequest } from "../http/route.ts";
import { importTweakcnTheme, listThemes } from "../themes.ts";

export const THEMES_ROUTE = "/__hui/themes";
const THEME_IMPORT_ROUTE = "/__hui/themes/import";

export function createThemeRoutes() {
  async function handle(request: RouteRequest): Promise<JsonResult | undefined> {
    if (request.path === THEMES_ROUTE && request.method === "GET") {
      return { status: 200, body: { themes: (await listThemes()).themes } };
    }
    if (request.path === THEME_IMPORT_ROUTE && request.method === "POST") {
      const body = (await request.json()) as { url?: unknown };
      if (typeof body.url !== "string") return { status: 400, body: { error: "Expected a url." } };
      try {
        const id = await importTweakcnTheme(body.url);
        return { status: 200, body: { id, themes: (await listThemes()).themes } };
      } catch (error) {
        return { status: 400, body: { error: error instanceof Error ? error.message : "Import failed." } };
      }
    }
    return undefined;
  }

  return { handle };
}
