/**
 * Words and small helpers the gateway-extension surfaces share: the state labels, the route summary a row shows and
 * the empty/trust copy. Pure, so both the Settings page and its tests read the same sentences.
 */
import type { ExtensionRouteInfo, ExtensionStatus } from "../../api/schema/extensions.ts";

export const EXTENSION_STATE_LABEL: Readonly<Record<ExtensionStatus["state"], string>> = {
  loaded: "Loaded",
  disabled: "Disabled",
  failed: "Failed",
  missing: "Missing",
};

export const EXTENSION_TRUST_NOTE =
  "Gateway extensions run inside the gateway with its access to this machine, its credentials and its data. Only enable code you trust.";

export const EXTENSION_EMPTY_NOTE =
  "No gateway extensions installed. A module goes in ~/.config/hui/extensions/<id>/ with an extension.json and an ESM entry file.";

/** "2 routes · GET, POST", or "No routes" before one loads. */
export function extensionRoutesSummary(routes: readonly ExtensionRouteInfo[]): string {
  if (routes.length === 0) return "No routes";
  const methods = [...new Set(routes.map((route) => route.method))];
  return `${routes.length} route${routes.length === 1 ? "" : "s"} · ${methods.join(", ")}`;
}

/** The row's accessible switch label. */
export function extensionToggleLabel(extension: Pick<ExtensionStatus, "name">): string {
  return `Enable ${extension.name}`;
}
