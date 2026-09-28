import { execFileSync, spawn } from "node:child_process";
import { isIP } from "node:net";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { allowedHostsFromEnv, hostName, tailnetFromStatus } from "../server/host.ts";
import { gatewayLogs, gatewayStatus, startGateway, stopGateway } from "./gateway.ts";
import { packageVersion, type Installation } from "./installation.ts";
import { LOG_FILE, withLifecycleLock } from "./state.ts";
import { updateRelease } from "./update.ts";
import { checkRelease } from "./releases.ts";

export const HELP = `Usage:
  hui gateway start [--host <IP|tailnet>] [--port <number>] [--allow-host <name>] [--json]
  hui gateway stop [--force] [--json]
  hui gateway restart [--force] [--host <IP|tailnet>] [--port <number>] [--allow-host <name>] [--json]
  hui gateway status [--json]
  hui gateway logs [--lines <number>]
  hui gateway run [--host <IP|tailnet>] [--port <number>] [--allow-host <name>]
  hui ui [--no-open]
  hui desktop
  hui install-app
  hui update [--check] [--json]
  hui update --from <local.tgz> [--sha256 <digest>]
  hui update --rollback
  hui --version

HUI_GATEWAY_HOST and HUI_GATEWAY_PORT configure defaults; CLI flags override them.
A reverse proxy needs its Host name allowed: --allow-host <name>, repeatable,
which is remembered with the binding. HUI_GATEWAY_ALLOWED_HOSTS takes a
comma-separated list instead, for a gateway started by something you do not edit.
The gateway binds 127.0.0.1:4173 by default. No login is provided; prefer Tailscale.
Stop/restart refuse active work unless --force explicitly interrupts it.
Updates use GitHub Releases via gh authentication, and never edit a source checkout or PI data.
Gateway without a subcommand is an alias for foreground run.
`;

export function parseCli(args: string[], env: NodeJS.ProcessEnv = process.env) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, strict: true, options: {
    help: { type: "boolean", short: "h" }, version: { type: "boolean", short: "v" }, json: { type: "boolean" },
    force: { type: "boolean" }, host: { type: "string" }, port: { type: "string" }, lines: { type: "string" },
    "allow-host": { type: "string", multiple: true },
    "no-open": { type: "boolean" }, from: { type: "string" }, sha256: { type: "string" }, rollback: { type: "boolean" },
    check: { type: "boolean" },
  } });
  if (values.help || !args.length) return { command: "help", values };
  if (values.version) return { command: "version", values };
  const [first, second, ...extra] = positionals;
  const command = first === "gateway" ? `gateway ${second ?? "run"}` : first;
  const allowed: Record<string, string[]> = {
    "gateway start": ["host", "port", "json", "allow-host"], "gateway run": ["host", "port", "allow-host"],
    "gateway stop": ["force", "json"], "gateway restart": ["host", "port", "force", "json", "allow-host"],
    "gateway status": ["json"], "gateway logs": ["lines"], ui: ["no-open"], browser: ["no-open"],
    update: ["from", "sha256", "rollback", "check", "json"], desktop: [], "install-app": [],
  };
  if (!command || !allowed[command] || extra.length || first !== "gateway" && second) throw new Error("Unknown command. Run hui --help.");
  for (const flag of Object.keys(values)) if (!allowed[command]!.includes(flag)) throw new Error(`--${flag} is not valid for ${command}.`);
  if (["gateway start", "gateway run", "gateway restart"].includes(command)) {
    values.host ??= env["HUI_GATEWAY_HOST"];
    values.port ??= env["HUI_GATEWAY_PORT"];
  }
  if (values.port !== undefined && (!/^\d+$/u.test(values.port) || Number(values.port) > 65535)) throw new Error("--port must be between 0 and 65535.");
  if (values["allow-host"]) values["allow-host"] = values["allow-host"].map((name) => hostName(name, "--allow-host"));
  if (values.lines !== undefined && (!/^\d+$/u.test(values.lines) || Number(values.lines) < 1 || Number(values.lines) > 1000)) throw new Error("--lines must be between 1 and 1000.");
  if (values.rollback && (values.from || values.sha256) || values.sha256 && !values.from) throw new Error("Use either --from [--sha256] or --rollback.");
  if (values.sha256 && !/^[a-fA-F0-9]{64}$/u.test(values.sha256)) throw new Error("--sha256 must be a 64-character hexadecimal digest.");
  if (values.check && (values.from || values.sha256 || values.rollback)) throw new Error("--check cannot be combined with --from, --sha256 or --rollback.");
  return { command, values };
}

export function binding(host = "127.0.0.1"): { host: string; allowedHosts: string[] } {
  if (host === "tailnet") {
    const result = tailnetFromStatus(execFileSync("tailscale", ["status", "--json"], { encoding: "utf8", timeout: 5_000 }));
    if (!result) throw new Error("Tailscale did not report an address. Is tailscale up?");
    return { host: result.host, allowedHosts: [...result.allowedHosts ?? []] };
  }
  if (host === "localhost") host = "127.0.0.1";
  if (!isIP(host) || host === "0.0.0.0" || host === "::") throw new Error("--host needs a specific IP address or tailnet, not a wildcard.");
  return { host, allowedHosts: [] };
}

export async function main(args: string[], installation: Installation): Promise<void> {
  const { command, values } = parseCli(args);
  if (command === "help") { process.stdout.write(HELP); return; }
  if (command === "version") { console.log(await packageVersion(installation.packageRoot)); return; }
  if (command === "desktop" || command === "install-app") {
    const module = await import(pathToFileURL(join(installation.packageRoot, "desktop", command === "desktop" ? "launch.mjs" : "install.mjs")).href);
    if (command === "desktop") await module.launchDesktop(installation.installationRoot);
    else await module.installApp(installation.installationRoot);
    return;
  }
  // Read before any gateway is stopped, so a bad list cannot cost a running one.
  const extraAllowedHosts = [...allowedHostsFromEnv(), ...(values["allow-host"] ?? [])];
  const requestedBinding = values.host !== undefined ? binding(values.host) : undefined;
  const report = (result: unknown) => console.log(values.json ? JSON.stringify(result) : typeof result === "object" ? JSON.stringify(result, null, 2) : result);
  if (command === "update" && values.check) { report(await checkRelease(installation)); return; }
  if (command === "gateway status") { const status = await gatewayStatus(); report(status); if (status.status === "unresponsive") process.exitCode = 1; return; }
  if (command === "gateway logs") { process.stdout.write(await gatewayLogs(Number(values.lines ?? 100))); return; }
  if (command === "ui" || command === "browser") {
    const status = await gatewayStatus();
    if (status.status !== "running" || !status.url) throw new Error("Gateway is not running. Start it with hui gateway start.");
    console.log(status.url);
    const headless = process.platform === "linux" && !process.env["DISPLAY"] && !process.env["WAYLAND_DISPLAY"];
    if (values["no-open"] || headless) return;
    const executable = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
    const child = spawn(executable, process.platform === "win32" ? ["/c", "start", "", status.url] : [status.url], { detached: true, stdio: "ignore" });
    await new Promise<void>((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); }); child.unref();
    return;
  }
  await withLifecycleLock(async () => {
    if (command === "update") { report(await updateRelease(installation, values)); return; }
    if (command === "gateway stop") { await stopGateway(values.force); report({ status: "stopped" }); return; }
    const previous = command === "gateway restart" ? await stopGateway(values.force) : undefined;
    const host = requestedBinding ?? (previous ? { host: previous.host, allowedHosts: previous.allowedHosts } : binding());
    const options = { ...installation, ...host, allowedHosts: [...new Set([...host.allowedHosts, ...extraAllowedHosts])], port: Number(values.port ?? previous?.port ?? 4173) };
    if (command === "gateway run") {
      const current = await gatewayStatus();
      if (current.status !== "stopped") throw new Error("A gateway is already running or unresponsive.");
      const { runGateway } = await import("../server/gateway.ts");
      const gateway = await runGateway(options);
      console.log(`HUI ${gateway.state.version} · ${gateway.state.url}`);
      // The servers keep the foreground process alive; release the operation
      // lock now so another CLI can query/stop it.
      return;
    }
    try { report(await startGateway(options)); }
    catch (error) {
      if (previous) await startGateway({ ...previous, packageRoot: previous.packageRoot });
      throw error;
    }
    if (!values.json) console.log(`Logs: ${LOG_FILE}`);
  });
}
