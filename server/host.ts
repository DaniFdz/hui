/**
 * Where the dev server listens.
 *
 * The app drives agents, so it stays on loopback unless someone asks for more.
 * `--host <address>` opens it to exactly that address; `--host tailnet` is a
 * marker the launcher resolves, because resolving it means running `tailscale`.
 */

import { readFile } from "node:fs/promises";

/** What `--host` asked for, before `tailnet` is resolved to a real address. */
export type HostArgument = { host: string };

export class HostArgumentError extends Error {}

/**
 * Reads `--host <address>` out of the CLI arguments.
 *
 * Returns undefined when the flag is absent, which leaves Vite on its default
 * loopback binding.
 */
export function parseHost(argv: readonly string[]): HostArgument | undefined {
  const at = argv.indexOf("--host");
  if (at === -1) {
    return undefined;
  }
  const value = argv[at + 1];
  // A missing value or another flag next means the user typed `--host` alone;
  // Vite would then bind every interface, which is the opposite of the intent.
  if (!value || value.startsWith("--")) {
    throw new HostArgumentError("--host needs an address, or `tailnet`");
  }
  return { host: value };
}

/** True when the caller asked for the machine's own Tailscale address. */
export function wantsTailnet(argument: HostArgument | undefined): boolean {
  return argument?.host === "tailnet";
}

/** The binding for the tailnet address, including the DNS name Vite must allow. */
export type TailnetBinding = { host: string; allowedHosts?: readonly string[] };

/**
 * Reads `tailscale status --json` for the address to bind and the name to allow.
 *
 * Vite refuses a request whose `Host` header it does not recognise, so binding
 * the address alone leaves the friendlier tailnet name answering 403.
 *
 * Returns undefined when the output carries no usable IPv4 address, which is the
 * caller's cue to fall back to an explicit `--host`.
 */
export function tailnetFromStatus(raw: string): TailnetBinding | undefined {
  let status: unknown;
  try {
    status = JSON.parse(raw);
  } catch {
    return undefined;
  }
  const self = (status as { Self?: { TailscaleIPs?: unknown; DNSName?: unknown } } | null)?.Self;
  const addresses = Array.isArray(self?.TailscaleIPs) ? self.TailscaleIPs : [];
  // The IPv4 one: an IPv6 literal is valid but awkward to type into a browser.
  const host = addresses.find(
    (value): value is string => typeof value === "string" && value.includes("."),
  );
  if (!host) {
    return undefined;
  }
  const name =
    typeof self?.DNSName === "string" ? self.DNSName.replace(/\.$/, "") : "";
  return { host, ...(name ? { allowedHosts: [name] } : {}) };
}

/** A dot-separated host name or IPv4 address: no scheme, port, path or wildcard. */
const HOST_NAME = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/;

/**
 * One host name as a `Host` header may carry: lowercased, without a trailing
 * dot, which is the same name. Empty input yields "", which callers skip; an
 * unusable name throws, because a typo must not hide behind the same 403 it was
 * meant to remove.
 */
export function hostName(entry: string, source: string): string {
  // A trailing dot is the same name; `tailscale status` prints it that way.
  const name = entry.trim().toLowerCase().replace(/\.$/, "");
  if (name && (name.length > 253 || !HOST_NAME.test(name))) {
    throw new Error(`${source}: "${entry.trim()}" is not a host name.`);
  }
  return name;
}

/**
 * Extra `Host` names from the comma-separated `HUI_GATEWAY_ALLOWED_HOSTS`.
 *
 * A reverse proxy answers on a name of its own while connecting over loopback:
 * `tailscale serve` keeps the name the browser asked for, so the gateway
 * refuses it unless that name is granted here or with `--allow-host`.
 */
export function allowedHostsFromEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env["HUI_GATEWAY_ALLOWED_HOSTS"] ?? "")
    .split(",")
    .map((entry) => hostName(entry, "HUI_GATEWAY_ALLOWED_HOSTS"))
    .filter(Boolean);
}

/**
 * Extra `Host` names from `allowHosts` in the gateway's `config.json`, read on
 * every start so updates, reboots and desktop launches all keep them.
 * `"tailnet"` is this machine's Tailscale DNS name, resolved by `tailnet()`;
 * when Tailscale is down that entry is skipped so the gateway still starts. A
 * missing file grants nothing; a malformed one throws for the same reason as
 * `hostName`.
 */
export async function allowedHostsFromConfig(file: string, tailnet: () => Promise<string | undefined>): Promise<string[]> {
  let raw: string;
  try { raw = await readFile(file, "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  const source = `${file} allowHosts`;
  let entries: unknown;
  try { entries = (JSON.parse(raw) as { allowHosts?: unknown } | null)?.allowHosts ?? []; }
  catch { throw new Error(`${file} is not valid JSON.`); }
  if (!Array.isArray(entries) || !entries.every((entry) => typeof entry === "string")) throw new Error(`${source} must be a list of host names.`);
  const names: string[] = [];
  for (const entry of entries) {
    const name = entry.trim().toLowerCase() === "tailnet" ? await tailnet() : entry;
    if (name) names.push(hostName(name, source));
  }
  return names.filter(Boolean);
}
