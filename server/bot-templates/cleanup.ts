/**
 * The automatic cleanup of a bot's export (SPEC.md, "Bot exports are templates, reviewed for personal information"),
 * before any model reads it: the operator's profile name becomes `{{user}}`, home folder paths `~`, and e-mail
 * addresses, this machine's user and host names and its workers' names inside a path, address or link, tailnet names,
 * IP addresses, Slack IDs and text shaped like a key or token `[removed]`. Text changes in place (`cleanText`); a script
 * is only searched, never rewritten (`cleanText(…).hits`). Pure: the export service says who the operator is.
 */

export type CleanupIdentity = {
  /** Settings' profile name, when it is set. */
  operator?: string;
  /** The home folders of this machine and, for a bot on a worker, of the worker. */
  homes: readonly string[];
  /** This machine's user name. */
  username: string;
  /** This machine's host name and, for a bot on a worker, the worker's. */
  hostnames: readonly string[];
  /** The names of the remote workers. */
  workers: readonly string[];
};

/** What one rule changed in a text: its kind, how often, and what the first one was (a secret shortened). */
export type CleanupHit = { kind: string; sample: string; count: number };

export const REMOVED = "[removed]";
export const USER_PLACEHOLDER = "{{user}}";

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
const masked = (secret: string) => `${secret.slice(0, 4)}…`;

/** Words that are also first names, so a word of the profile name that is one of them is left to the reviewer.
 * ponytail: a short list, not a dictionary; the reviewer reads the rest of the name. */
const COMMON_WORDS = new Set(["will", "mark", "max", "may", "june", "april", "august", "grace", "rose", "bill", "pat", "sue", "art", "joy", "hope", "faith", "summer", "autumn", "frank", "rich", "chase", "hunter", "page", "dawn", "sky", "river", "jack", "sunny", "honey", "lily", "daisy", "ivy", "holly", "robin", "jay", "drew", "gene", "guy", "don", "rob", "bob", "pierce", "miles", "victor"]);
/** User, host and worker names too generic to be anyone's. */
const GENERIC_NAMES = new Set(["root", "admin", "user", "users", "ubuntu", "debian", "bits", "dev", "runner", "ec2-user", "localhost", "home", "mac", "macbook", "workspace", "default", "worker", "server"]);

/** Where a match stands: its groups, and its offset in the whole text. */
type At = { groups: string[]; offset: number; input: string };
type Rule = { kind: string; pattern: RegExp; replace: (match: string, at: At) => string; sample?: (match: string, at: At) => string };

const DELIMITER = /[\s"'`<>()[\]{}]/u;
/** Whether the text around a match is a path, an address or a link: its token, up to a delimiter, holds a / or an @. */
function inPath(input: string, start: number, end: number): boolean {
  let from = start;
  while (from > 0 && start - from < 200 && !DELIMITER.test(input[from - 1]!)) from -= 1;
  let to = end;
  while (to < input.length && to - end < 200 && !DELIMITER.test(input[to]!)) to += 1;
  return /[/@]/u.test(input.slice(from, start) + input.slice(end, to));
}

const SECRET_PREFIXES = /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,}|xox[abposr]-[A-Za-z0-9-]{10,}|sk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})\b/gu;

function rules(identity: CleanupIdentity): Rule[] {
  const list: Rule[] = [
    { kind: "a private key", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/gu, replace: () => REMOVED, sample: () => "-----BEGIN … PRIVATE KEY-----" },
    { kind: "a key or token", pattern: SECRET_PREFIXES, replace: () => REMOVED, sample: masked },
    { kind: "a key or token", pattern: /\b(bearer\s+)([A-Za-z0-9_\-.=+/]{16,})/giu, replace: (_match, at) => `${at.groups[0]}${REMOVED}`, sample: (_match, at) => masked(at.groups[1]!) },
    {
      kind: "a key or token",
      // A value with a digit, not code that reads one (`process.env.X`, `os.environ.get(…)`, `$TOKEN`).
      pattern: /\b((?:api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|token|secret|password|passwd)["']?\s*[:=]\s*["']?)(?!process\.|os\.|env\.|getenv|\$)(?=[^\s"'`,;()]*\d)([^\s"'`,;()]{12,})/giu,
      replace: (_match, at) => `${at.groups[0]}${REMOVED}`,
      sample: (_match, at) => masked(at.groups[1]!),
    },
    { kind: "a trigger's link", pattern: /\/__hui\/hooks\/[A-Za-z0-9_-]+/gu, replace: () => `/__hui/hooks/${REMOVED}`, sample: () => "/__hui/hooks/…" },
    // `git@github.com:org/repo` is an address of git's, not a person's.
    // Bounded runs, so a long blob without an @ or a dot can't make these slow.
    { kind: "an e-mail address", pattern: /\b(?!git@)[A-Za-z0-9._%+-]{1,64}@(?:[A-Za-z0-9-]{1,63}\.){1,8}[A-Za-z]{2,24}\b/gu, replace: () => REMOVED },
    { kind: "a tailnet name", pattern: /\b(?:[a-z0-9-]{1,63}\.){1,10}ts\.net\b/giu, replace: () => REMOVED },
    {
      kind: "an IP address",
      pattern: /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/gu,
      replace: (match) => match.startsWith("127.") || match === "0.0.0.0" ? match : REMOVED,
    },
    { kind: "a Slack ID", pattern: /\b[UCWGD](?=(?:[A-Z]*\d){2})[A-Z0-9]{8,11}\b/gu, replace: () => REMOVED },
  ];
  const homes = identity.homes.filter((home) => home && home !== "/").map((home) => `${escape(home)}(?![^/\\s"'\`])|`).join("");
  list.push({ kind: "a home folder", pattern: new RegExp(`${homes}/(?:Users|home)/[^/\\s"'\`]+`, "gu"), replace: () => "~" });
  const names = machineNames(identity);
  for (const [kind, name] of names) {
    // Only inside a path, an address or a link: a token holding a / or an @.
    list.push({
      kind, pattern: new RegExp(`(?<![A-Za-z0-9])${escape(name)}(?![A-Za-z0-9])`, "giu"),
      replace: (match, at) => inPath(at.input, at.offset, at.offset + match.length) ? REMOVED : match, sample: () => name,
    });
  }
  const operator = identity.operator?.replace(/\s+/gu, " ").trim();
  if (operator) {
    list.push({ kind: "your name", pattern: new RegExp(`(?<![\\p{L}\\p{N}])${operator.split(" ").map(escape).join("\\s+")}(?![\\p{L}\\p{N}])`, "giu"), replace: () => USER_PLACEHOLDER });
    for (const word of new Set(operator.split(" "))) {
      if (word.length < 3 || COMMON_WORDS.has(word.toLowerCase()) || !/^\p{L}+$/u.test(word)) continue;
      list.push({ kind: "your name", pattern: new RegExp(`(?<![\\p{L}\\p{N}])${escape(word)}(?![\\p{L}\\p{N}])`, "gu"), replace: () => USER_PLACEHOLDER });
    }
  }
  return list;
}

/** This machine's user name, host names and workers' names, as distinctive as a cleanup needs them. */
function machineNames(identity: CleanupIdentity): (readonly [kind: string, name: string])[] {
  return [
    ...[identity.username].map((name) => ["this machine's user name", name] as const),
    ...identity.hostnames.flatMap((host) => [host, host.split(".")[0] ?? ""]).map((name) => ["this machine's name", name] as const),
    ...identity.workers.map((name) => ["a worker's name", name] as const),
  ].filter(([, name]) => name.length >= 3 && !GENERIC_NAMES.has(name.toLowerCase()));
}

/**
 * What a skill's name or a file's path gives away, if anything: what the cleanup would change in it, or a word of the
 * operator's name or of the machine's names in it, any case (`dani-reviews`). An identifier can't be rewritten, so what
 * holds one stays behind.
 */
export function personalIn(identifier: string, identity: CleanupIdentity): string | undefined {
  const hit = cleanText(identifier, identity).hits[0];
  if (hit) return hit.kind;
  const words = new Set(identifier.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean));
  const own = (identity.operator ?? "").toLowerCase().split(/\s+/u).filter((word) => word.length >= 3 && !COMMON_WORDS.has(word));
  if (own.some((word) => words.has(word))) return "your name";
  const joined = identifier.toLowerCase();
  return machineNames(identity).find(([, name]) => joined.includes(name.toLowerCase()))?.[0];
}

/** `text` with the cleanup done, and what it did, by kind. */
export function cleanText(text: string, identity: CleanupIdentity): { text: string; hits: CleanupHit[] } {
  const hits = new Map<string, CleanupHit>();
  let result = text;
  for (const rule of rules(identity)) {
    result = result.replace(rule.pattern, (match: string, ...rest: unknown[]) => {
      // A replacer gets the groups, then the offset and the whole text (none of these patterns has named groups).
      const at: At = { groups: rest.slice(0, -2).map((group) => typeof group === "string" ? group : ""), offset: rest.at(-2) as number, input: rest.at(-1) as string };
      const replaced = rule.replace(match, at);
      if (replaced !== match) {
        const hit = hits.get(rule.kind);
        if (hit) hit.count += 1;
        else hits.set(rule.kind, { kind: rule.kind, sample: rule.sample?.(match, at) ?? match, count: 1 });
      }
      return replaced;
    });
  }
  return { text: result, hits: [...hits.values()] };
}
