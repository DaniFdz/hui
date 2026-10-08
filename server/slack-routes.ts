/**
 * `/__hui/slack` (HUI-18, Slack triggers): the gateway's Slack connection, as Settings → Integrations → Slack and
 * `hui slack` use it; see docs/api.md#slack.
 *
 *   GET    /__hui/slack[?verify=1]   SlackConnection (`verify` asks Slack again when its last answer is stale)
 *   PUT    /__hui/slack  { token }   SlackConnection, once auth.test accepted the token; 400 for input, 502 when Slack
 *                                    refused it or could not be reached
 *   DELETE /__hui/slack              SlackConnection: the token removed from this machine
 *
 * No answer, error or diagnostic ever carries the token: the body is read only for it, a body that isn't JSON is
 * refused without quoting it, and every view is built field by field.
 */
import type { SlackConnection } from "../shared/slack.ts";
import { SLACK_AUTH_ERRORS, SlackApiError, SlackInputError, type SlackConnector } from "./slack.ts";

export const SLACK_ROUTE = "/__hui/slack";
const BODY_BYTES = 4 * 1024;

export type SlackRouteRequest = {
  method: string;
  path: string;
  /** The query string's `verify`. */
  verify: boolean;
  /** The JSON body, at most `maxBytes`. */
  body(maxBytes: number): Promise<unknown>;
};

export function createSlackRoutes(deps: { connector: Pick<SlackConnector, "connect" | "disconnect" | "view">; watch: () => SlackConnection["watch"] }) {
  const { connector } = deps;

  async function handle(request: SlackRouteRequest): Promise<{ status: number; body: unknown } | undefined> {
    if (request.path !== SLACK_ROUTE) return undefined;
    try {
      if (request.method === "GET") return { status: 200, body: await connector.view(deps.watch(), { verify: request.verify }) };
      if (request.method === "PUT") {
        let body: unknown;
        try {
          body = await request.body(BODY_BYTES);
        } catch {
          // A parse error quotes the body, which holds the token: say nothing of it.
          throw new SlackInputError("Send the token as JSON: { \"token\": \"xoxp-…\" }.");
        }
        const token = typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>)["token"] : undefined;
        if (typeof body !== "object" || body === null || Array.isArray(body) || Object.keys(body).some((key) => key !== "token")) {
          throw new SlackInputError("Send only the token: { \"token\": \"xoxp-…\" }.");
        }
        await connector.connect(token);
        return { status: 200, body: await connector.view(deps.watch()) };
      }
      if (request.method === "DELETE") {
        await connector.disconnect();
        return { status: 200, body: await connector.view(deps.watch()) };
      }
      return { status: 405, body: { error: "method not allowed" } };
    } catch (error) {
      if (error instanceof SlackInputError) return { status: 400, body: { error: error.message } };
      if (error instanceof SlackApiError && SLACK_AUTH_ERRORS.has(error.code)) {
        return { status: 502, body: { error: `Slack refused this token (${error.code}): copy the User OAuth Token (xoxp-…) from your Slack app's OAuth & Permissions page, after installing the app to your workspace.`, code: error.code } };
      }
      if (error instanceof SlackApiError) return { status: 502, body: { error: `Slack did not accept the token: ${error.message}`, code: error.code } };
      return { status: 500, body: { error: "The Slack connection could not be saved." } };
    }
  }

  return { handle };
}
