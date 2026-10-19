/**
 * A conversation's shared terminals: `GET/POST /__hui/sessions/:id/terminals[/:terminal]` (list, read, create and
 * operate them, over `terminals.ts`) and `POST …/terminals/:terminal/connect` (the live view's one-use ticket,
 * from `terminal-transport.ts`). `hui.ts` applies the `x-hui` guard before dispatching here.
 */
import type { JsonResult, RouteRequest } from "../http/route.ts";
import type { SessionRecord } from "../sessions.ts";
import { terminalTicket } from "../terminal-transport.ts";
import { terminals, TerminalError } from "../terminals.ts";

const TERMINAL_ROUTE = /^\/__hui\/sessions\/([^/]+)\/terminals(?:\/([^/]+))?(?:\/(connect))?$/u;

export function createTerminalRoutes(deps: { readRegistry(): Promise<SessionRecord[]> }) {
  async function handle(request: RouteRequest): Promise<JsonResult | undefined> {
    const terminalRoute = request.path.match(TERMINAL_ROUTE);
    if (!terminalRoute) return undefined;
    try {
      const owner = terminalRoute[1]!;
      const id = terminalRoute[2];
      const session = (await deps.readRegistry()).find((record) => record.id === owner);
      if (!session) throw new TerminalError("Conversation not found.", 404);
      if (session.worker) throw new TerminalError("Terminals are not available for sessions on a remote worker yet.", 409);
      if (request.method === "GET") {
        if (terminalRoute[3]) throw new TerminalError("Method not allowed.", 405);
        return { status: 200, body: id ? terminals.read(owner, id) : { terminals: terminals.list(owner) } };
      }
      if (request.method === "POST") {
        if (terminalRoute[3] && id) return { status: 200, body: { url: terminalTicket(owner, id) } };
        let body: unknown;
        try { body = await request.json(128 * 1024); } catch { throw new TerminalError("Invalid terminal request body."); }
        if (!body || typeof body !== "object" || Array.isArray(body)) throw new TerminalError("Terminal request must be an object.");
        const params = body as Record<string, unknown>;
        return {
          status: id ? 200 : 201,
          body: id ? terminals.tool(owner, { ...params, sessionId: id }) : { terminal: terminals.create(owner, session.cwd, params) },
        };
      }
      throw new TerminalError("Method not allowed.", 405);
    } catch (error) {
      return { status: error instanceof TerminalError ? error.status : 500, body: { error: error instanceof Error ? error.message : "Terminal request failed." } };
    }
  }

  return { handle };
}
