/**
 * Browser client for a session's terminals: listing, opening and closing them, and connecting to one over a
 * WebSocket. The gateway owns the PTYs; the browser only holds the socket.
 */
import { fetchJson } from "./settings-store.ts";
import type { TerminalView } from "./terminal-types.ts";

const url = (owner: string, id?: string) => `/__hui/sessions/${encodeURIComponent(owner)}/terminals${id ? `/${encodeURIComponent(id)}` : ""}`;
const post = (body: unknown = {}) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
export async function listTerminals(owner: string): Promise<TerminalView[]> {
  return (await fetchJson<{ terminals: TerminalView[] }>(url(owner))).terminals;
}
export async function createTerminal(owner: string): Promise<TerminalView> {
  return (await fetchJson<{ terminal: TerminalView }>(url(owner), post())).terminal;
}
export async function endTerminal(owner: string, id: string): Promise<void> {
  await fetchJson(url(owner, id), post({ action: "close" }));
}
export async function connectTerminal(owner: string, id: string): Promise<WebSocket> {
  const result = await fetchJson<{ url: string }>(`${url(owner, id)}/connect`, post());
  const address = new URL(result.url, location.href);
  address.protocol = address.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(address);
  // PTY output arrives as binary messages (shared/terminal-stream.ts); take them as bytes, not Blobs.
  socket.binaryType = "arraybuffer";
  return socket;
}
