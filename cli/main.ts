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
import { checkNightly, checkRelease } from "./releases.ts";
import { BOT_THINKING_LEVELS } from "../shared/bots.ts";

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
  hui update --nightly [--check] [--json]
  hui update --from <local.tgz> [--sha256 <digest>]
  hui update --rollback
  hui doctor [--fix] [--json]
  hui workers list [--json]
  hui workers add --name <name> --command <connect command> [--extra-path <path>] [--json]
  hui workers edit <name|id> [--name <name>] [--command <connect command>] [--extra-path <path>] [--json]
  hui workers remove <name|id> [--json]
  hui bot list [--archived] [--json]
  hui bot show <bot> [--json]
  hui bot add [--name <name>] [--title <text>] [--soul-file <path|->] [--cwd <dir>]
              [--model <provider/model>] [--thinking <level>] [--memory-model <provider/model>] [--emoji <e>] [--json]
  hui bot edit <bot> [same flags as add but --soul-file] [--json]
  hui bot soul <bot> [--file <path|->] [--json]
  hui bot remove <bot> [--json]
  hui bot restore <bot> [--json]
  hui bot delete <bot> [--yes] [--json]
  hui bot chat <bot>
  hui bot send <bot> <message|-> [--wait] [--timeout <seconds>] [--json]
  hui bot stop <bot> [--json]
  hui bot memory <bot> [--zoom <id+n>] [--html <file>] [--json]
  hui bot routine list <bot> [--json]
  hui bot routine add <bot> --name <name> --prompt <text> (--at <ISO time> | --every <duration> | --cron <expr>
              [--timezone <tz>]) [--json]
  hui bot routine run <bot> <routine>
  hui bot routine remove <bot> <routine> [--json]
  hui --version

HUI_GATEWAY_HOST and HUI_GATEWAY_PORT configure defaults; CLI flags override them.
A reverse proxy needs its Host name allowed: --allow-host <name>, repeatable,
which is remembered with the binding. HUI_GATEWAY_ALLOWED_HOSTS takes a
comma-separated list instead, for a gateway started by something you do not edit.
The gateway binds 127.0.0.1:4173 by default. No login is provided; prefer Tailscale.
Stop/restart refuse work a restart would interrupt unless --force explicitly does so;
Pi Durable sessions keep running and resume when the gateway is back.
Updates use public GitHub Releases, and never edit a source checkout or PI data.
--nightly installs the build of the latest validated main commit instead of the
latest stable release; a plain hui update returns to stable once one is newer.
Doctor reports state an upgraded HUI needs changed, such as sessions still on PI;
--fix changes it while the gateway is stopped. It exits 1 while anything remains.
Gateway without a subcommand is an alias for foreground run.
Workers are the remote machines of Settings → Workers, managed through the
running gateway. A new worker connects at once; --extra-path is repeatable and
on edit replaces the list. Edit changes only the fields given; a new command
applies the next time the worker connects.
Bots are named agents with one forever chat each, managed through the running
gateway like the Bots tab; "bots" works as "bot". <bot> is an id, a handle or
an exact name. A new bot starts by asking what you expect from it (talk with
hui bot chat <handle>), then writes its persona, SOUL.md, itself; --soul-file
gives it one instead (- reads stdin) and skips that first conversation. Without
--name it is "New Bot" and first asks what to call it. Soul prints SOUL.md;
--file replaces it, and an empty file removes it so the bot asks again. On edit, --model "" and --thinking "" go back to the model and
thinking level a new chat gets, --memory-model "" to the chat's own model.
Remove archives: the chat transcript and memory are kept and its routines are
disabled. Delete removes a bot for good, active or archived: its turn stops, its
chat leaves HUI, and its routines, memory and folder (SOUL.md and every file in
it) go; a workspace you chose stays. It asks first; --yes skips that, and is
needed where it cannot ask (no terminal). Chat streams the replies as plain
text and sends what you
type (steering a turn that runs); messages from elsewhere (routines, other
bots, the Bots tab) show as > lines. Ctrl+C stops a turn, twice exits. Send -
reads the message from stdin; with --wait it prints the reply and exits 0, 1 on
failure or timeout, 2 while the bot waits for an answer (give it in chat).
Routines are Automation tasks aimed at the bot's chat. --every takes 30s, 5m,
2h or 1d (Automation allows one minute at least); --cron uses this machine's
time zone unless --timezone names another.
`;

export function parseCli(args: string[], env: NodeJS.ProcessEnv = process.env) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, strict: true, options: {
    help: { type: "boolean", short: "h" }, version: { type: "boolean", short: "v" }, json: { type: "boolean" },
    force: { type: "boolean" }, host: { type: "string" }, port: { type: "string" }, lines: { type: "string" },
    "allow-host": { type: "string", multiple: true },
    "no-open": { type: "boolean" }, from: { type: "string" }, sha256: { type: "string" }, rollback: { type: "boolean" },
    check: { type: "boolean" }, fix: { type: "boolean" }, nightly: { type: "boolean" },
    name: { type: "string" }, command: { type: "string" }, "extra-path": { type: "string", multiple: true },
    archived: { type: "boolean" }, title: { type: "string" }, "soul-file": { type: "string" }, file: { type: "string" }, yes: { type: "boolean", short: "y" },
    cwd: { type: "string" }, model: { type: "string" }, thinking: { type: "string" }, "memory-model": { type: "string" },
    emoji: { type: "string" }, wait: { type: "boolean" }, timeout: { type: "string" }, zoom: { type: "string" }, html: { type: "string" },
    prompt: { type: "string" }, at: { type: "string" }, every: { type: "string" }, cron: { type: "string" }, timezone: { type: "string" },
  } });
  if (values.help || !args.length) return { command: "help", values };
  if (values.version) return { command: "version", values };
  const [first, second, ...extra] = positionals;
  const bots = first === "bot" || first === "bots";
  const routine = bots && (second === "routine" || second === "routines");
  const command = bots ? (routine ? `bot routine ${extra.shift() ?? "list"}` : `bot ${second ?? "list"}`)
    : first === "gateway" ? `gateway ${second ?? "run"}` : first === "workers" ? `workers ${second ?? "list"}` : first;
  // `workers edit` and `workers remove` name the worker they act on.
  const target = command === "workers edit" || command === "workers remove" ? extra.shift() : undefined;
  // A bot command's operands: the bot, then a message or a routine.
  const operands = bots ? extra.splice(0) : [];
  const allowed: Record<string, string[]> = {
    "gateway start": ["host", "port", "json", "allow-host"], "gateway run": ["host", "port", "allow-host"],
    "gateway stop": ["force", "json"], "gateway restart": ["host", "port", "force", "json", "allow-host"],
    "gateway status": ["json"], "gateway logs": ["lines"], ui: ["no-open"], browser: ["no-open"],
    update: ["from", "sha256", "rollback", "check", "json", "nightly"], desktop: [], "install-app": [],
    doctor: ["fix", "json"], "workers list": ["json"], "workers add": ["name", "command", "extra-path", "json"],
    "workers edit": ["name", "command", "extra-path", "json"], "workers remove": ["json"],
    "bot list": ["archived", "json"], "bot show": ["json"], "bot add": [...BOT_FIELDS, "soul-file", "json"], "bot edit": [...BOT_FIELDS, "json"],
    "bot soul": ["file", "json"],
    "bot remove": ["json"], "bot restore": ["json"], "bot delete": ["yes", "json"], "bot chat": [], "bot send": ["wait", "timeout", "json"], "bot stop": ["json"],
    "bot memory": ["zoom", "html", "json"], "bot routine list": ["json"],
    "bot routine add": ["name", "prompt", "at", "every", "cron", "timezone", "json"], "bot routine run": [], "bot routine remove": ["json"],
  };
  if (!command || !allowed[command] || extra.length || first !== "gateway" && first !== "workers" && !bots && second) throw new Error("Unknown command. Run hui --help.");
  if (command === "bot edit" && values["soul-file"] !== undefined) throw new Error("bot edit does not change SOUL.md: use hui bot soul <bot> --file <path|->.");
  for (const flag of Object.keys(values)) if (!allowed[command]!.includes(flag)) throw new Error(`--${flag} is not valid for ${command}.`);
  if (bots) checkBotCommand(command, operands, values);
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
  if (values.nightly && (values.from || values.sha256 || values.rollback)) throw new Error("--nightly cannot be combined with --from, --sha256 or --rollback.");
  if (command === "workers add" && (!values.name || !values.command)) throw new Error("workers add needs --name and --command.");
  if ((command === "workers edit" || command === "workers remove") && !target) throw new Error(`${command} needs the worker's name or id.`);
  if (command === "workers edit" && values.name === undefined && values.command === undefined && !values["extra-path"]) throw new Error("workers edit needs --name, --command or --extra-path.");
  return { command, values, ...(target ? { target } : {}), ...(bots ? { operands } : {}) };
}

/** The flags `bot add` and `bot edit` share. */
const BOT_FIELDS = ["name", "title", "cwd", "model", "thinking", "memory-model", "emoji"];
/** Operands each bot command takes, in order. */
const BOT_OPERANDS: Record<string, readonly string[]> = {
  "bot list": [], "bot add": [], "bot show": ["bot"], "bot edit": ["bot"], "bot soul": ["bot"], "bot remove": ["bot"], "bot restore": ["bot"], "bot delete": ["bot"],
  "bot chat": ["bot"], "bot send": ["bot", "message"], "bot stop": ["bot"], "bot memory": ["bot"],
  "bot routine list": ["bot"], "bot routine add": ["bot"], "bot routine run": ["bot", "routine"], "bot routine remove": ["bot", "routine"],
};
const MODEL_REF = /^[^/\s]+\/\S+$/u;

/** What the gateway would refuse anyway, refused before a request. */
function checkBotCommand(command: string, operands: readonly string[], values: Record<string, string | boolean | string[] | undefined>): void {
  const expected = BOT_OPERANDS[command] ?? [];
  if (operands.length !== expected.length) {
    if (command === "bot send" && operands.length > 2) throw new Error("bot send takes the bot and one message: quote the message, or pass - to read it from stdin.");
    throw new Error(expected.length ? `${command} needs ${expected.map((name) => `<${name}>`).join(" ")}.` : `${command} takes no operands.`);
  }
  const given = (flag: string) => values[flag] !== undefined;
  if (command === "bot edit" && !BOT_FIELDS.some(given)) throw new Error(`bot edit needs at least one of ${BOT_FIELDS.map((flag) => `--${flag}`).join(", ")}.`);
  // `""` clears a choice: the gateway's default for the chat, the chat's own model for the memory.
  const cleared = (flag: string) => values[flag] === "";
  if (given("thinking") && !cleared("thinking") && !(BOT_THINKING_LEVELS as readonly string[]).includes(String(values["thinking"]))) throw new Error(`--thinking must be one of: ${BOT_THINKING_LEVELS.join(", ")}.`);
  for (const flag of ["model", "memory-model"]) if (given(flag) && !cleared(flag) && !MODEL_REF.test(String(values[flag]))) throw new Error(`--${flag} must be provider/model.`);
  if (given("timeout") && (!values["wait"] || !/^\d+$/u.test(String(values["timeout"])) || Number(values["timeout"]) < 1 || Number(values["timeout"]) > 3600)) {
    throw new Error("--timeout needs --wait and 1-3600 seconds.");
  }
  if (given("zoom") && given("html")) throw new Error("Use either --zoom or --html.");
  if (given("zoom") && !/^\d{1,15}\+\d{1,15}$/u.test(String(values["zoom"]))) throw new Error("--zoom takes a view line's id+n, such as 2184+8.");
  if (command === "bot routine add") {
    if (!values["name"] || !values["prompt"]) throw new Error("bot routine add needs --name and --prompt.");
    if (["at", "every", "cron"].filter(given).length !== 1) throw new Error("bot routine add needs exactly one of --at, --every or --cron.");
    if (given("timezone") && !given("cron")) throw new Error("--timezone only applies to --cron.");
    if (given("every") && !/^\d{1,9}(s|m|h|d)$/u.test(String(values["every"]))) throw new Error("--every takes a duration such as 30s, 5m, 2h or 1d.");
    if (given("at") && !Number.isFinite(Date.parse(String(values["at"])))) throw new Error("--at takes an ISO date and time, such as 2026-10-06T09:00:00+02:00.");
  }
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
  const { command, values, target, operands } = parseCli(args);
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
  if (command === "update" && values.check) { report(await (values.nightly ? checkNightly : checkRelease)(installation)); return; }
  if (command === "doctor") {
    const { formatDoctorReport, runDoctor } = await import("./doctor.ts");
    const result = await runDoctor({ fix: values.fix === true });
    console.log(values.json ? JSON.stringify(result) : formatDoctorReport(result));
    if (!result.ok) process.exitCode = 1;
    return;
  }
  if (command.startsWith("workers ")) {
    const status = await gatewayStatus();
    if (status.status !== "running" || !status.url) throw new Error("Gateway is not running. Start it with hui gateway start.");
    const { formatWorkers, workersCommand } = await import("./workers.ts");
    const action = command.slice("workers ".length);
    const result = await workersCommand(status.url, action, target, values);
    if (action === "list" && !values.json) console.log(formatWorkers(result as Parameters<typeof formatWorkers>[0])); else report(result);
    return;
  }
  if (command.startsWith("bot ")) {
    const status = await gatewayStatus();
    if (status.status !== "running" || !status.url) throw new Error("Gateway is not running. Start it with hui gateway start.");
    const { botCommand, terminalBotIO } = await import("./bots.ts");
    process.exitCode = await botCommand(status.url, command.slice("bot ".length), operands ?? [], values, terminalBotIO());
    return;
  }
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
