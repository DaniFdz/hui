/**
 * HUI's managed browser: `GET/POST /__hui/browser` (its status, start and stop, over `browser/manager.ts`),
 * `GET /__hui/browser/tabs/:tab/preview` (an operator preview of one tab, as a data URL) and, dispatched earlier
 * with the routes no diagnostic records, `POST /__hui/sessions/:id/browser/connect` (a browser pane's one-use
 * ticket, from `browser-transport.ts`). `hui.ts` applies the `x-hui` guard before dispatching here.
 */
import type { JsonResult, RouteRequest } from "../http/route.ts";
import { browserViewTicket } from "../browser-transport.ts";
import { BrowserToolError, type ManagedBrowser } from "../browser/manager.ts";
import type { SessionRecord } from "../sessions.ts";

const BROWSER_ROUTE = "/__hui/browser";
const BROWSER_TAB_PREVIEW = /^\/__hui\/browser\/tabs\/(t\d{1,6})\/preview$/u;
const BROWSER_VIEW_ROUTE = /^\/__hui\/sessions\/([^/]+)\/browser\/connect$/u;

export function createBrowserRoutes(deps: {
  managedBrowser: ManagedBrowser;
  browserStatus(): Promise<unknown>;
  readRegistry(): Promise<SessionRecord[]>;
}) {
  async function connect(request: RouteRequest): Promise<JsonResult | undefined> {
    const browserViewRoute = request.path.match(BROWSER_VIEW_ROUTE);
    if (!browserViewRoute) return undefined;
    try {
      if (request.method !== "POST") throw new BrowserToolError("Method not allowed.", 405);
      const owner = browserViewRoute[1]!;
      if (!(await deps.readRegistry()).some((record) => record.id === owner)) throw new BrowserToolError("Conversation not found.", 404);
      return { status: 200, body: { url: browserViewTicket(owner) } };
    } catch (error) {
      return { status: error instanceof BrowserToolError ? error.status : 500, body: { error: error instanceof Error ? error.message : "Browser view request failed." } };
    }
  }

  async function handle(request: RouteRequest): Promise<JsonResult | undefined> {
    const { managedBrowser, browserStatus } = deps;
    if (request.path === BROWSER_ROUTE) {
      try {
        if (request.method === "GET") return { status: 200, body: await browserStatus() };
        if (request.method !== "POST") return { status: 405, body: { error: "method not allowed" } };
        let body: unknown;
        try { body = await request.json(); } catch { throw new BrowserToolError("Browser request body must be JSON."); }
        const action = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>)["action"] : undefined;
        if (action === "start") await managedBrowser.start();
        else if (action === "stop") await managedBrowser.stop();
        else throw new BrowserToolError("action must be start or stop.");
        return { status: 200, body: await browserStatus() };
      } catch (error) {
        return {
          status: error instanceof BrowserToolError ? error.status : 500,
          body: { error: error instanceof Error ? error.message : "The browser request failed." },
        };
      }
    }
    const browserPreview = request.path.match(BROWSER_TAB_PREVIEW);
    if (browserPreview) {
      if (request.method !== "GET") return { status: 405, body: { error: "method not allowed" } };
      try {
        const image = await managedBrowser.preview(browserPreview[1] ?? "");
        return { status: 200, body: { image: `data:${image.mimeType};base64,${image.data}` } };
      } catch (error) {
        return {
          status: error instanceof BrowserToolError ? error.status : 500,
          body: { error: error instanceof Error ? error.message : "The tab could not be captured." },
        };
      }
    }
    return undefined;
  }

  return { connect, handle };
}
