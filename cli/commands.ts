/** The shape of the `hui` command line: every command, the flags it accepts and the fields `bot add`/`schedule add`
 * share. `parseCli` refuses what this table omits and `cli/completion.ts` offers its words to bash and zsh, so a
 * command or flag cannot exist in one of them and be missing from the other. */

/** Words a command answers to besides the one this table names it by. */
export const COMMAND_ALIASES: Readonly<Record<string, string>> = { bots: "bot", schedules: "schedule" };

/** The flags `schedule add` and `schedule edit` share. */
export const SCHEDULE_FIELDS = ["name", "prompt", "description", "at", "every", "cron", "timezone", "bot", "session", "timeout", "until", "runs", "disabled"];

/** The flags `bot add` and `bot edit` share. */
export const BOT_FIELDS = ["name", "title", "description", "tagging", "cwd", "model", "thinking", "memory-model", "utility-model", "emoji", "shape", "ears", "color", "language", "call-voice"];

/** The flags each command accepts, keyed by the words that name it. `completion` is answered before parsing, and its
 * entry is here so a shell can offer it too. */
export const COMMAND_FLAGS: Readonly<Record<string, readonly string[]>> = {
  "gateway start": ["host", "port", "json", "allow-host"], "gateway run": ["host", "port", "allow-host"],
  "gateway stop": ["force", "json"], "gateway restart": ["host", "port", "force", "json", "allow-host"],
  "gateway status": ["json"], "gateway logs": ["lines"], ui: ["no-open"], browser: ["no-open"],
  update: ["from", "sha256", "rollback", "check", "json", "nightly", "force"], desktop: [], "install-app": [],
  doctor: ["fix", "json"], completion: [], "workers list": ["json"], "workers add": ["name", "command", "extra-path", "json"],
  "workers edit": ["name", "command", "extra-path", "json"], "workers remove": ["json"],
  "extension list": ["json"], "extension enable": ["json"], "extension disable": ["json"], "extension reload": ["json"],
  "extension add": ["link", "json"], "extension remove": ["delete", "json"],
  "bot list": ["archived", "json"], "bot show": ["json"], "bot add": [...BOT_FIELDS, "soul-file", "worker", "deny-tools", "deny-skills", "json"], "bot edit": [...BOT_FIELDS, "json"],
  "bot soul": ["file", "json"], "bot user": ["json"], "bot memory": ["json"], "bot history": ["zoom", "html", "json"], "bot bootstrap": ["file", "json"], "bot split": ["wait", "timeout", "json"],
  "bot tools": ["allow", "deny", "json"], "bot skills": ["allow", "deny", "json"],
  "bot import": ["worker", "agent", "yes", "json"], "bot export": ["out", "review", "set", "add", "yes", "json"],
  "bot remove": ["json"], "bot restore": ["json"], "bot delete": ["yes", "json"], "bot chat": [], "bot send": ["wait", "timeout", "json"], "bot stop": ["json"],
  "bot routine list": ["json"],
  "bot routine add": ["name", "prompt", "at", "every", "cron", "timezone", "json"], "bot routine run": [], "bot routine remove": ["json"],
  "bot trigger list": ["json"], "bot trigger remove": ["json"], "bot trigger test": ["json"],
  "bot trigger add": ["name", "prompt", "match", "cooldown", "pr-links", "allow-bots", "allow-external", "json"],
  "schedule list": ["bot", "session", "json"], "schedule show": ["json"], "schedule add": [...SCHEDULE_FIELDS, "json"], "schedule edit": [...SCHEDULE_FIELDS, "json"],
  "schedule pause": ["json"], "schedule resume": ["json"], "schedule run": ["json"], "schedule remove": ["json"],
};
