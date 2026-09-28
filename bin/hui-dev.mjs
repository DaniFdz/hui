#!/usr/bin/env node
/**
 * Development-only launcher. Installed releases use bin/hui.mjs.
 *
 *   hui browser   open in the default browser
 *   hui desktop   open the production Electron app (build first)
 *   hui gateway   serve only; no window, so sessions outlive the UI
 *
 * Browser/gateway serve the development app; desktop uses the built release.
 */
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { launchDesktop } from "../desktop/launch.mjs";
import { createServer } from "vite";

import { allowedHostsFromEnv, HostArgumentError, parseHost, tailnetFromStatus, wantsTailnet } from "../server/host.ts";

const MODES = ["browser", "desktop", "gateway"];
const args = process.argv.slice(2);
const mode = args[0] ?? "browser";
if (mode === "desktop") {
  if (args.includes("--host")) throw new Error("Configure desktop binding through hui gateway start --host.");
  await launchDesktop(fileURLToPath(new URL("../", import.meta.url)));
  process.exit(0);
}

if (mode === "--help" || mode === "-h") {
  console.log("Usage: hui <browser|desktop|gateway> [--host <address>|tailnet]");
  console.log("  --host     also listen on that address (default: loopback only)");
  console.log("             `--host tailnet` uses this machine's Tailscale address");
  process.exit(0);
}

if (!MODES.includes(mode)) {
  console.error(`hui: unknown mode "${mode}" — expected one of: ${MODES.join(", ")}`);
  process.exit(1);
}

/**
 * The app drives agents, so opening it past loopback is opt-in and explicit.
 * An empty result leaves Vite on its default binding.
 */
function resolveHost() {
  let argument;
  try {
    argument = parseHost(args);
  } catch (error) {
    if (error instanceof HostArgumentError) {
      console.error(`hui: ${error.message}`);
      process.exit(1);
    }
    throw error;
  }
  if (!argument) {
    return {};
  }
  if (!wantsTailnet(argument)) {
    return { host: argument.host };
  }
  try {
    // The tailnet address is the one another device can reach without putting
    // the app on the LAN, and it is not stable enough to hard-code.
    const binding = tailnetFromStatus(
      execFileSync("tailscale", ["status", "--json"], { encoding: "utf8" }),
    );
    if (!binding) {
      throw new Error("no IPv4 address reported");
    }
    return binding;
  } catch {
    console.error(
      "hui: could not read the Tailscale address (is `tailscale up` running?); pass --host <address> instead",
    );
    process.exit(1);
  }
}

const { host, allowedHosts } = resolveHost();
// A reverse proxy answers on a name of its own while connecting to loopback.
const allowed = [...allowedHosts ?? [], ...allowedHostsFromEnv()];

function openDetached(command, args) {
  spawn(command, args, { detached: true, stdio: "ignore" }).unref();
}

function openInDefaultBrowser(url) {
  if (process.platform === "darwin") {
    openDetached("open", [url]);
  } else if (process.platform === "win32") {
    openDetached("cmd", ["/c", "start", "", url]);
  } else {
    openDetached("xdg-open", [url]);
  }
}

const server = await createServer({
  server: { ...(host ? { host } : {}), ...(allowed.length ? { allowedHosts: allowed } : {}) },
});
await server.listen();

const url = server.resolvedUrls?.local?.[0] ?? server.resolvedUrls?.network?.[0];
if (!url) {
  console.error("hui: dev server started but reported no local URL");
  await server.close();
  process.exit(1);
}

server.printUrls();

if (mode === "browser") openInDefaultBrowser(url);
// gateway opens nothing: the URL printed above is the whole interface.

async function shutdown() {
  await server.close();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
