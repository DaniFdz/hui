/**
 * Browser client for HUI's managed, agent-only browser: its status, start and stop, tab previews and the
 * live-view socket for a conversation's tabs. The gateway owns the browser process; this module only crosses
 * `/__hui/` routes to reach it.
 */
import { normalizeBrowserStatus, type BrowserStatus } from "../../shared/browser.ts";
import { fetchJson } from "./settings-store.ts";

const BROWSER_URL = "/__hui/browser";

export async function loadBrowserStatus(): Promise<BrowserStatus> {
  return normalizeBrowserStatus(await fetchJson<unknown>(BROWSER_URL));
}

/** Launching waits for the browser's DevTools handshake, which can take a
 * while on a cold start; the default 5-second fetch ceiling is too short. */
export async function controlBrowser(action: "start" | "stop"): Promise<BrowserStatus> {
  return normalizeBrowserStatus(await fetchJson<unknown>(BROWSER_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action }),
    signal: AbortSignal.timeout(45_000),
  }));
}

/** One-use live view of a conversation's tabs: JSON state/actions and binary frames. */
export async function connectBrowserView(sessionId: string): Promise<WebSocket> {
  const result = await fetchJson<{ url: string }>(`/__hui/sessions/${encodeURIComponent(sessionId)}/browser/connect`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  const address = new URL(result.url, location.href);
  address.protocol = address.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(address);
  socket.binaryType = "arraybuffer";
  return socket;
}

/** A JPEG data URL of one tab's viewport, captured without changing focus. */
export async function previewBrowserTab(id: string): Promise<string> {
  const body = await fetchJson<{ image?: unknown }>(`${BROWSER_URL}/tabs/${encodeURIComponent(id)}/preview`, {
    signal: AbortSignal.timeout(15_000),
  });
  if (typeof body.image !== "string" || !body.image.startsWith("data:image/")) throw new Error("The preview was not an image.");
  return body.image;
}
