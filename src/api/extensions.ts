/**
 * Browser client for gateway extensions: the installed list and the enable switch. An extension's own routes are its
 * own contract; a panel calls them through its bridge, not through this module.
 */
import { fetchJson } from "./request.ts";
import type { ExtensionStatus, ExtensionsResponse } from "./schema/extensions.ts";

const EXTENSIONS_URL = "/__hui/ext";
const JSON_HEADERS = { "content-type": "application/json" } as const;

export async function loadExtensions(): Promise<ExtensionsResponse> {
  return await fetchJson<ExtensionsResponse>(EXTENSIONS_URL);
}

/** Records the choice; the returned status is the extension's state right after the reconciliation. */
export async function setExtensionEnabled(id: string, enabled: boolean): Promise<ExtensionStatus> {
  return await fetchJson<ExtensionStatus>(`${EXTENSIONS_URL}/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: JSON_HEADERS,
    body: JSON.stringify({ enabled }),
  });
}
