/**
 * A conversation's shared terminals: `GET/POST /__hui/sessions/:id/terminals[/:terminal]` (list, read, create and
 * operate them, over `terminals.ts`) and `POST …/terminals/:terminal/connect` (the live view's one-use ticket,
 * from `terminal-transport.ts`). A conversation on a remote worker gets its shell there through that worker's
 * connect command. `hui.ts` applies the `x-hui` guard before dispatching here.
 */
import { reply, type JsonResult, type RouteRequest } from "../http/route.ts";
import { TerminalSnapshot, TerminalsResponse, TerminalResponse, TerminalOperationResponse, TerminalConnectResponse, TerminalError as TerminalErrorPayload } from "../api/terminals.ts";
export { routeSchemas } from "../api/terminals.ts";
import type { SessionRecord } from "../sessions/sessions.ts";
import { WorkerNotFoundError } from "../workers.ts";
import { terminalTicket } from "../terminals/transport.ts";
import { terminals, TerminalError } from "../terminals/terminals.ts";

const TERMINAL_ROUTE = /^\/__hui\/sessions\/([^/]+)\/terminals(?:\/([^/]+))?(?:\/(connect))?$/u;

export function createTerminalRoutes(deps: { readRegistry(): Promise<SessionRecord[]>; workers: { get(id: string): Promise<{ command: string[] }> } }) {
  async function handle(request: RouteRequest): Promise<JsonResult | undefined> {
    const terminalRoute = request.path.match(TERMINAL_ROUTE);
    if (!terminalRoute) return undefined;
    try {
      const owner = terminalRoute[1]!;
      const id = terminalRoute[2];
      const session = (await deps.readRegistry()).find((record) => record.id === owner);
      if (!session) throw new TerminalError("Conversation not found.", 404);
      if (request.method === "GET") {
        if (terminalRoute[3]) throw new TerminalError("Method not allowed.", 405);
        return id ? reply(TerminalSnapshot, terminals.read(owner, id)) : reply(TerminalsResponse, { terminals: terminals.list(owner) });
      }
      if (request.method === "POST") {
        if (terminalRoute[3] && id) return reply(TerminalConnectResponse, { url: terminalTicket(owner, id) });
        let body: unknown;
        try { body = await request.json(128 * 1024); } catch { throw new TerminalError("Invalid terminal request body."); }
        if (!body || typeof body !== "object" || Array.isArray(body)) throw new TerminalError("Terminal request must be an object.");
        const params = body as Record<string, unknown>;
        return id
          ? reply(TerminalOperationResponse, terminals.tool(owner, { ...params, sessionId: id }))
          : reply(TerminalResponse, { terminal: terminals.create(owner, session.cwd, params, await connectCommand(session.worker)) }, 201);
      }
      throw new TerminalError("Method not allowed.", 405);
    } catch (error) {
      return reply(TerminalErrorPayload, { error: error instanceof Error ? error.message : "Terminal request failed." }, error instanceof TerminalError ? error.status : 500);
    }
  }

  /** The worker's own connect command, which opens a shell on the machine the conversation runs on. */
  async function connectCommand(worker: string | undefined): Promise<string[] | undefined> {
    if (!worker) return undefined;
    try {
      return (await deps.workers.get(worker)).command;
    } catch (error) {
      if (error instanceof WorkerNotFoundError) throw new TerminalError(`${error.message} Its terminal cannot open.`, 409);
      throw error;
    }
  }

  return { handle };
}
