/**
 * `/__hui/datadog…`: the `pup` connection, its orgs and sign-in (`datadog.ts`) and dashboard and share previews
 * (`datadog-previews.ts`). `hui.ts` applies the `x-hui` guard before dispatching here.
 */
import { DatadogError, type DatadogOrgs } from "../datadog.ts";
import type { DatadogPreviews } from "../datadog-previews.ts";
import type { JsonResult, RouteRequest } from "../http/route.ts";
import { MAX_DATADOG_EMBEDS, parseDatadogUrl } from "../integrations/datadog-links.ts";

const DATADOG_ROUTE = "/__hui/datadog";
const DATADOG_ORGS_ROUTE = `${DATADOG_ROUTE}/orgs`;
const DATADOG_LOGIN_ROUTE = `${DATADOG_ROUTE}/login`;
const DATADOG_PREVIEWS_ROUTE = `${DATADOG_ROUTE}/previews`;

/** A Datadog route failure: the operator's input (400/404/409) or HUI's own (500), never pup's output. */
function datadogError(error: unknown): JsonResult {
  if (error instanceof DatadogError) return { status: error.status, body: { error: error.message } };
  if (error instanceof SyntaxError) return { status: 400, body: { error: "Send a JSON body." } };
  return { status: 500, body: { error: error instanceof Error ? error.message : "Datadog request failed." } };
}

export function createDatadogRoutes(deps: { datadogOrgs: DatadogOrgs; datadogPreviews: DatadogPreviews }) {
  async function handle(request: RouteRequest): Promise<JsonResult | undefined> {
    const { method, path } = request;
    const { datadogOrgs, datadogPreviews } = deps;

    if (path === DATADOG_ROUTE) {
      if (method !== "GET") return { status: 405, body: { error: "method not allowed" } };
      try {
        return { status: 200, body: await datadogOrgs.connection() };
      } catch (error) {
        return datadogError(error);
      }
    }

    if (path === DATADOG_ORGS_ROUTE) {
      if (method !== "POST" && method !== "DELETE") return { status: 405, body: { error: "method not allowed" } };
      try {
        const params = request.query;
        return {
          status: 200,
          body: method === "POST"
            ? await datadogOrgs.add(await request.json())
            : await datadogOrgs.remove({ name: params.get("name") ?? "", site: params.get("site") ?? "" }),
        };
      } catch (error) {
        return datadogError(error);
      }
    }

    if (path === DATADOG_LOGIN_ROUTE) {
      if (method !== "POST" && method !== "DELETE") return { status: 405, body: { error: "method not allowed" } };
      try {
        return { status: 200, body: method === "POST" ? await datadogOrgs.startLogin(await request.json()) : await datadogOrgs.cancelLogin() };
      } catch (error) {
        return datadogError(error);
      }
    }

    if (path === DATADOG_PREVIEWS_ROUTE) {
      if (method !== "GET") return { status: 405, body: { error: "method not allowed" } };
      const urls = request.query.getAll("url");
      if (urls.length === 0 || urls.length > MAX_DATADOG_EMBEDS || urls.some((url) => url.length > 4_000 || !parseDatadogUrl(url))) {
        return { status: 400, body: { error: `Pass 1-${MAX_DATADOG_EMBEDS} Datadog share or dashboard URLs.` } };
      }
      return { status: 200, body: { previews: await Promise.all(urls.map((url) => datadogPreviews.lookup(url))) } };
    }

    return undefined;
  }

  return { handle };
}
