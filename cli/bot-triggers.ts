/**
 * `hui bot trigger`: a bot's triggers (HUI-18) from a terminal, through the running gateway's trigger routes, as the
 * Triggers section of the Bots tab uses them: list, add, remove and test.
 */
import {
  BOT_TRIGGER_SOURCE_LABELS, GITHUB_TRIGGER_EVENTS, SESSION_TRIGGER_EVENTS, SLACK_TRIGGER_EVENTS, botTriggerFilterSummary, cooldownLabel,
  type BotTrigger, type BotTriggerCreated, type BotTriggerRun, type BotTriggersList,
} from "../shared/bot-triggers.ts";
import type { BotView } from "../shared/bots.ts";
import type { BotIO } from "./bots.ts";

export type TriggerFlags = {
  json?: boolean;
  name?: string;
  prompt?: string;
  /** `add`: the source, one of these five. */
  github?: string;
  session?: boolean;
  webhook?: boolean;
  slack?: boolean;
  listener?: boolean;
  on?: string;
  /** `--slack`: only messages with a pull request link, from these people, in these channels, and who else may wake it;
   * `--listener`: the same switches, for the events a listener marks. */
  "pr-links"?: boolean;
  from?: string;
  in?: string;
  "allow-bots"?: boolean;
  "allow-external"?: boolean;
  author?: string;
  label?: string;
  base?: string;
  pr?: string;
  draft?: boolean;
  ready?: boolean;
  match?: string;
  cooldown?: string;
};

const list = (value: string | undefined) => (value ?? "").split(",").map((item) => item.trim()).filter(Boolean);

/** `0`, `45s`, `5m`, `2h` or `1d` as seconds. */
export function parseCooldown(value: string): number {
  const match = /^(\d{1,6})(s|m|h|d)?$/u.exec(value.trim());
  if (!match) throw new Error("--cooldown takes 0 or a duration such as 30s, 5m or 1h.");
  return Number(match[1]) * { s: 1, m: 60, h: 3_600, d: 86_400 }[(match[2] ?? "s") as "s" | "m" | "h" | "d"];
}

/** `field=value` (equals) or `field~value` (contains); no field matches the whole body (a listener's: the whole event). */
export function parseMatch(value: string): { field: string; op: "equals" | "contains"; value: string } {
  const match = /^([^=~]*)([=~])(.+)$/u.exec(value);
  if (!match) throw new Error("--match takes field=value (equals) or field~value (contains), such as action=opened.");
  return { field: match[1]!.trim(), op: match[2] === "~" ? "contains" : "equals", value: match[3]! };
}

/** The body of `POST /__hui/bots/:id/triggers` from `add`'s flags; the gateway checks it all again. */
export function triggerBody(flags: TriggerFlags): Record<string, unknown> {
  const events = list(flags.on);
  const body: Record<string, unknown> = { name: flags.name };
  if (flags.prompt !== undefined) body["prompt"] = flags.prompt;
  if (flags.cooldown !== undefined) body["cooldownSeconds"] = parseCooldown(flags.cooldown);
  if (flags.github !== undefined) {
    body["source"] = "github";
    body["filter"] = {
      repos: list(flags.github),
      events,
      ...(flags.author !== undefined ? { authors: list(flags.author).map((login) => login.replace(/^@/u, "")) } : {}),
      ...(flags.label !== undefined ? { labels: list(flags.label) } : {}),
      ...(flags.base !== undefined ? { base: list(flags.base) } : {}),
      ...(flags.pr !== undefined ? { pullRequests: list(flags.pr).map((number) => Number(number.replace(/^#/u, ""))) } : {}),
      ...(flags.draft ? { draft: true } : flags.ready ? { draft: false } : {}),
    };
  } else if (flags.session) {
    body["source"] = "session";
    body["filter"] = { events };
  } else if (flags.slack) {
    body["source"] = "slack";
    body["filter"] = {
      events,
      ...(flags["pr-links"] ? { prLinks: true } : {}),
      ...(flags.from !== undefined ? { from: list(flags.from).map((person) => person.replace(/^@/u, "")) } : {}),
      ...(flags.in !== undefined ? { in: list(flags.in).map((channel) => channel.replace(/^#/u, "")) } : {}),
      ...(flags["allow-external"] ? { external: true } : {}),
      ...(flags["allow-bots"] ? { bots: true } : {}),
    };
  } else if (flags.listener) {
    body["source"] = "listener";
    body["filter"] = {
      ...(flags.match !== undefined ? { match: parseMatch(flags.match) } : {}),
      ...(flags["pr-links"] ? { prLinks: true } : {}),
      ...(flags["allow-external"] ? { external: true } : {}),
      ...(flags["allow-bots"] ? { bots: true } : {}),
    };
  } else {
    body["source"] = "webhook";
    body["filter"] = flags.match !== undefined ? { match: parseMatch(flags.match) } : {};
  }
  return body;
}

/** One trigger per line, with its id's start to name it by. */
export function formatTriggers(bot: Pick<BotView, "handle">, result: BotTriggersList): string {
  if (!result.triggers.length) return `@${bot.handle} has no triggers. Add one with hui bot trigger add ${bot.handle} --name <name> --github <owner/name> --on pr_opened.`;
  return [
    ...result.triggers.map((trigger) => formatTrigger(trigger)),
    `Deliveries in the last hour: ${result.deliveries.lastHour} of ${result.deliveries.perHour}.`,
  ].join("\n");
}

export function formatTrigger(trigger: BotTrigger): string {
  return [
    `${trigger.name} (${trigger.id.slice(0, 8)})`,
    BOT_TRIGGER_SOURCE_LABELS[trigger.source],
    botTriggerFilterSummary(trigger),
    `cooldown ${cooldownLabel(trigger.cooldownSeconds)}`,
    trigger.enabled ? "on" : "off",
    trigger.lastFiredAt ? `last fired ${trigger.lastFiredAt}` : "never fired",
    ...(trigger.pending ? [`${trigger.pending.events} waiting until ${trigger.pending.until}`] : []),
    ...(trigger.watch?.error ? [`${BOT_TRIGGER_SOURCE_LABELS[trigger.source]}: ${trigger.watch.error}`] : []),
  ].join(" · ");
}

/** Runs one `hui bot trigger` action and returns the exit code. */
export async function triggerCommand(base: string, action: string, operands: readonly string[], flags: TriggerFlags, io: BotIO): Promise<number> {
  const print = (value: unknown, text: string) => io.out(`${flags.json ? JSON.stringify(value) : text}\n`);
  // Loaded here, so `hui --help` and the argument checks above don't load the rest of the bot CLI.
  const { findBot, request } = await import("./bots.ts");
  const bot = await findBot(base, operands[0]!);
  const path = `/__hui/bots/${encodeURIComponent(bot.id)}/triggers`;
  const one = (ref: string) => `${path}/${encodeURIComponent(ref)}`;
  switch (action) {
    case "list": {
      const result = await request<BotTriggersList>(base, path);
      print(result, formatTriggers(bot, result));
      return 0;
    }
    case "add": {
      const created = await request<BotTriggerCreated>(base, path, { method: "POST", body: triggerBody(flags), timeoutMs: 30_000 });
      const url = created.hook ? new URL(created.hook.path, base).href : undefined;
      const listener = created.trigger.source === "listener";
      print(created, url
        ? `Added the ${listener ? "listener" : "webhook"} trigger ${created.trigger.name} to @${bot.handle}. Its URL, shown this once (${listener ? "your listener POSTs { \"events\": [...] } to it after every check" : "POST JSON or text to it"} from this machine or your tailnet; use the gateway's tailnet name from elsewhere):\n${url}`
        : `Added the trigger ${created.trigger.name} to @${bot.handle}: ${botTriggerFilterSummary(created.trigger)}.`);
      return 0;
    }
    case "remove": {
      await request(base, one(operands[1]!), { method: "DELETE" });
      print({ removed: operands[1], bot: bot.handle }, `Removed the trigger ${operands[1]} of @${bot.handle}.`);
      return 0;
    }
    case "test": {
      const { run } = await request<{ run: BotTriggerRun }>(base, `${one(operands[1]!)}/test`, { method: "POST", body: {}, timeoutMs: 90_000 });
      print(run, run.status === "fired" ? `Sent a test event to @${bot.handle}: ${run.summary}.` : `The test did not reach @${bot.handle}: ${run.reason ?? run.status}.`);
      return run.status === "fired" ? 0 : 1;
    }
    default:
      throw new Error("Unknown command. Run hui --help.");
  }
}

/** What `add` would refuse anyway, refused before a request. */
export function checkTriggerAdd(values: Record<string, unknown>): void {
  const given = (flag: string) => values[flag] !== undefined && values[flag] !== false;
  const sources = ["github", "session", "webhook", "slack", "listener"].filter(given);
  if (!values["name"]) throw new Error("bot trigger add needs --name.");
  if (sources.length !== 1) throw new Error("bot trigger add needs exactly one of --github <owner/name,…>, --session, --webhook, --slack or --listener.");
  const events = list(values["on"] as string | undefined);
  if (given("github")) {
    if (!list(values["github"] as string).length) throw new Error("--github needs owner/name, comma-separated for several repos.");
    const unknown = events.filter((event) => !(GITHUB_TRIGGER_EVENTS as readonly string[]).includes(event));
    if (!events.length || unknown.length) throw new Error(`--on takes GitHub events, comma-separated: ${GITHUB_TRIGGER_EVENTS.join(", ")}.`);
  } else {
    for (const flag of ["author", "label", "base", "pr", "draft", "ready"]) if (given(flag)) throw new Error(`--${flag} only applies to --github.`);
  }
  if (given("session")) {
    const unknown = events.filter((event) => !(SESSION_TRIGGER_EVENTS as readonly string[]).includes(event));
    if (!events.length || unknown.length) throw new Error(`--on takes session events, comma-separated: ${SESSION_TRIGGER_EVENTS.join(", ")}.`);
  }
  if (given("slack")) {
    const unknown = events.filter((event) => !(SLACK_TRIGGER_EVENTS as readonly string[]).includes(event));
    if (!events.length || unknown.length) throw new Error(`--on takes Slack events, comma-separated: ${SLACK_TRIGGER_EVENTS.join(", ")} (mention: a message that @-mentions you in a channel or group DM; dm: a direct message to you).`);
    for (const flag of ["from", "in"]) if (given(flag) && !list(values[flag] as string).length) throw new Error(`--${flag} needs comma-separated names.`);
  } else {
    for (const flag of ["from", "in"]) if (given(flag)) throw new Error(`--${flag} only applies to --slack.`);
    if (!given("listener")) for (const flag of ["pr-links", "allow-bots", "allow-external"]) if (given(flag)) throw new Error(`--${flag} only applies to --slack or --listener.`);
  }
  if (given("webhook") && given("on")) throw new Error("--on doesn't apply to --webhook: every call wakes it, or those --match lets through.");
  if (given("listener") && given("on")) throw new Error("--on doesn't apply to --listener: every event it reports wakes it, or those --match lets through.");
  if (given("match") && !given("webhook") && !given("listener")) throw new Error("--match only applies to --webhook or --listener.");
  if (given("match")) parseMatch(String(values["match"]));
  if (given("draft") && given("ready")) throw new Error("Use either --draft (only drafts) or --ready (only ready pull requests).");
  if (given("pr") && list(values["pr"] as string).some((number) => !/^#?\d{1,10}$/u.test(number))) throw new Error("--pr takes pull request numbers, comma-separated.");
  if (given("cooldown")) parseCooldown(String(values["cooldown"]));
}
