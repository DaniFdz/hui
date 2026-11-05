/**
 * `hui extension`: lists the gateway's extensions and records the enable switch. It talks to the running gateway's
 * `/__hui/ext` surface through the CLI's own client; a stopped gateway says so like every other gateway command.
 */
import type { ExtensionStatus, ExtensionsResponse } from "../server/api/extensions.ts";
import { request } from "./gateway-client.ts";

export type ExtensionsAction = "list" | "enable" | "disable";
export type ExtensionsCommandResult = ExtensionsResponse | ExtensionStatus;

const STATE: Readonly<Record<ExtensionStatus["state"], string>> = {
  loaded: "loaded",
  disabled: "disabled",
  failed: "failed",
  missing: "missing",
};

function routesSummary(status: ExtensionStatus): string {
  if (status.routes.length === 0) return "no routes";
  return `${status.routes.length} route${status.routes.length === 1 ? "" : "s"} · ${[...new Set(status.routes.map((route) => route.method))].join(", ")}`;
}

/** One line per extension, sorted as the gateway returns them. */
export function formatExtensions(response: ExtensionsResponse): string {
  if (response.extensions.length === 0) return "No gateway extensions installed.";
  const width = Math.max(...response.extensions.map((extension) => extension.id.length));
  const lines = response.extensions.map((extension) =>
    `${extension.id.padEnd(width)}  ${STATE[extension.state].padEnd(8)}  ${extension.name} · ${routesSummary(extension)}${extension.enabled ? "" : " · off"}`);
  if (response.storeError) lines.push(`The enable list could not be read: ${response.storeError}`);
  return lines.join("\n");
}

export function formatExtension(status: ExtensionStatus): string {
  return `${status.id}: ${STATE[status.state]}${status.enabled ? "" : " (off)"}${status.error ? ` — ${status.error}` : ""}`;
}

/** The parsed command's request; `send` is injectable so the CLI test never needs a gateway. */
export async function extensionsCommand(
  base: string,
  action: ExtensionsAction,
  id: string | undefined,
  { send = request }: { send?: typeof request } = {},
): Promise<ExtensionsCommandResult> {
  if (action === "list") return await send<ExtensionsResponse>(base, "/__hui/ext");
  if (!id || !/^[a-z][a-z0-9-]{0,31}$/u.test(id)) throw new Error(`extension ${action} needs an extension id: see hui extension list.`);
  return await send<ExtensionStatus>(base, `/__hui/ext/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: { enabled: action === "enable" },
  });
}
