import { randomBytes } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { EventEmitter } from "node:events";
import { WebSocketServer, WebSocket } from "ws";
import { terminals, TerminalService, TerminalError, TERMINAL_INPUT_BYTES } from "./terminals.ts";

const tickets = new Map<string, { owner: string; id: string; expires: number }>();
export function terminalTicket(owner: string, id: string): string {
  terminals.read(owner, id);
  for (const [key, ticket] of tickets) if (ticket.expires <= Date.now()) tickets.delete(key);
  if (tickets.size >= 128) throw new TerminalError("Too many pending terminal connections.", 429);
  const ticket = randomBytes(32).toString("base64url");
  tickets.set(ticket, { owner, id, expires: Date.now() + 15_000 });
  return `/__hui/terminal-stream?ticket=${ticket}`;
}

export function validTerminalOrigin(request: IncomingMessage, allowedHosts?: ReadonlySet<string>): boolean {
  try {
    const origin = new URL(request.headers.origin ?? "");
    return ["http:", "https:"].includes(origin.protocol) && origin.host === request.headers.host && (!allowedHosts || allowedHosts.has(origin.hostname.toLowerCase()));
  } catch { return false; }
}

/** WebSocket cannot carry x-hui. A guarded POST mints a short-lived, single-use
 * capability; same-origin and Host checks also apply to the upgrade path. */
export function attachTerminalTransport(server: EventEmitter, allowedHosts?: ReadonlySet<string>, service: TerminalService = terminals): () => void {
  const wss = new WebSocketServer({ noServer: true, maxPayload: TERMINAL_INPUT_BYTES * 6 + 1024, perMessageDeflate: false });
  // Named handler permits detaching from Vite without owning its other sockets.
  const onUpgrade = (request: IncomingMessage, socket: import("node:stream").Duplex, head: Buffer) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname !== "/__hui/terminal-stream") return;
    const reject = () => { socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n"); };
    if (!validTerminalOrigin(request, allowedHosts) || wss.clients.size >= 64) { reject(); return; }
    const token = url.searchParams.get("ticket") ?? "";
    const ticket = tickets.get(token);
    tickets.delete(token);
    if (!ticket || ticket.expires <= Date.now()) { reject(); return; }
    try { service.read(ticket.owner, ticket.id); } catch { reject(); return; }
    wss.handleUpgrade(request, socket, head, (ws) => {
      let alive = true;
      ws.on("pong", () => { alive = true; });
      const heartbeat = setInterval(() => { if (!alive) ws.terminate(); else { alive = false; ws.ping(); } }, 30_000);
      heartbeat.unref();
      const unsubscribe = service.subscribe(ticket.owner, ticket.id, (event) => {
        if (ws.readyState !== WebSocket.OPEN) return;
        if (ws.bufferedAmount > 1024 * 1024) { ws.close(1013, "Reconnect for terminal replay"); return; }
        ws.send(JSON.stringify(event));
      });
      ws.on("message", (data, binary) => {
        try {
          if (binary) throw new TerminalError("Terminal messages must be JSON text.");
          const message = JSON.parse(data.toString()) as Record<string, unknown>;
          if (message?.["action"] === "input") service.input(ticket.owner, ticket.id, message["data"]);
          else if (message?.["action"] === "resize") service.resize(ticket.owner, ticket.id, message["cols"], message["rows"]);
          else throw new TerminalError("Unknown terminal message.");
        } catch (error) {
          ws.send(JSON.stringify({ type: "error", error: error instanceof Error ? error.message : "Terminal request failed." }));
        }
      });
      ws.on("error", () => ws.terminate());
      ws.once("close", () => { clearInterval(heartbeat); unsubscribe(); });
    });
  };
  server.on("upgrade", onUpgrade);
  return () => { server.off("upgrade", onUpgrade); for (const client of wss.clients) client.terminate(); wss.close(); tickets.clear(); };
}
