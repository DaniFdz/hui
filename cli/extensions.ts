/**
 * `hui extension`: lists the gateway's extensions and records the enable switch. It talks to the running gateway's
 * `/__hui/ext` surface through the CLI's own client; a stopped gateway says so like every other gateway command.
 */
import { cp, lstat, mkdir, readFile, rm, stat, symlink, unlink } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

import type { ExtensionStatus, ExtensionsResponse } from "../server/api/extensions.ts";
import { entryPath, extensionId, parseManifest } from "../server/extensions/registry.ts";
import { request } from "./gateway-client.ts";

export type ExtensionsAction = "list" | "enable" | "disable" | "reload";
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
  if (!id || !extensionId(id)) throw new Error(`extension ${action} needs an extension id: see hui extension list.`);
  if (action === "reload") return await send<ExtensionStatus>(base, `/__hui/ext/${encodeURIComponent(id)}/reload`, { method: "POST" });
  return await send<ExtensionStatus>(base, `/__hui/ext/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: { enabled: action === "enable" },
  });
}

/** Copies (or links) a local extension into the extensions directory after reading its manifest and entry. */
export async function installExtension(root: string, source: string, options: { link?: boolean } = {}): Promise<{ id: string; linked: boolean; path: string }> {
  const absolute = resolve(source);
  const id = extensionId(basename(absolute));
  if (!id) throw new Error(`the extension's directory name is not a valid id: ${basename(absolute)}`);
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(join(absolute, "extension.json"), "utf8"));
  } catch (error) {
    throw new Error(`${absolute} has no readable extension.json: ${error instanceof Error ? error.message : String(error)}`);
  }
  const manifest = parseManifest(raw);
  if (!manifest.ok) throw new Error(`${absolute}: ${manifest.error}`);
  const entry = entryPath(absolute, manifest.value.main);
  if (!entry) throw new Error("main must stay inside the extension directory");
  if (!(await stat(entry).catch(() => undefined))?.isFile()) throw new Error(`main is missing: ${manifest.value.main}`);
  const path = join(root, id);
  if (await lstat(path).catch(() => undefined)) throw new Error(`extension ${id} is already installed at ${path}`);
  await mkdir(root, { recursive: true });
  if (options.link) await symlink(absolute, path, "dir");
  else await cp(absolute, path, { recursive: true });
  return { id, linked: options.link === true, path };
}

/** Removes an installed extension's directory, or only its symlink, when `delete` is asked for. */
export async function removeExtension(root: string, id: string, options: { delete?: boolean } = {}): Promise<{ path: string; deleted: boolean }> {
  if (!extensionId(id)) throw new Error(`invalid extension id: ${id}`);
  const path = join(root, id);
  const info = await lstat(path).catch(() => undefined);
  if (!info) throw new Error(`extension ${id} is not installed at ${path}`);
  if (!options.delete) return { path, deleted: false };
  if (info.isSymbolicLink()) await unlink(path);
  else await rm(path, { recursive: true, force: true });
  return { path, deleted: true };
}
