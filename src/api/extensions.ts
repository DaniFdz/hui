/**
 * Browser client for gateway extensions: the installed list and the enable switch. An extension's own routes are its
 * own contract; a panel calls them through its bridge, not through this module.
 */
import { notePanelExtensions } from "../lib/extensions/panel-availability.ts";
import { CLIENT_HEADERS, fetchJson } from "./request.ts";
import type { ExtensionStatus, ExtensionsResponse } from "./schema/extensions.ts";

const EXTENSIONS_URL = "/__hui/ext";
const JSON_HEADERS = { "content-type": "application/json" } as const;

export async function loadExtensions(): Promise<ExtensionsResponse> {
  const response = await fetchJson<ExtensionsResponse>(EXTENSIONS_URL);
  notePanelExtensions(response.extensions);
  return response;
}

/** Records the choice; the returned status is the extension's state right after the reconciliation. */
export async function setExtensionEnabled(id: string, enabled: boolean): Promise<ExtensionStatus> {
  return await fetchJson<ExtensionStatus>(`${EXTENSIONS_URL}/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: JSON_HEADERS,
    body: JSON.stringify({ enabled }),
  });
}

/** One call from a panel, forwarded by the parent with the browser's own `x-hui` session. */
export async function callExtensionRoute(
  id: string,
  method: string,
  path: string,
  body: unknown,
  signal: AbortSignal,
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`/__hui/ext/${encodeURIComponent(id)}/${path}`, {
    method,
    headers: { ...CLIENT_HEADERS, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal,
    cache: "no-store",
    redirect: "error",
  });
  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }
  return { status: response.status, body: parsed };
}
