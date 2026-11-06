/**
 * The integration logins a gateway shares with a worker: each `gh` account as a hosts file, pup's Datadog
 * sessions and Jira's API token. The files ride in the sync, mode 0600, under `hui/integrations/`, so `gh` and
 * `pup` on the worker use the gateway's logins with no gateway attached, for exactly the accounts and orgs HUI
 * lists in Settings; Jira's token has no file of its own and travels in the sync's environment, where the agent's
 * Atlassian helper reads it. An integration the gateway is not signed in to writes nothing and says so in the
 * sync's skipped list.
 */
import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

import { GITHUB_HOST, parseAccounts } from "../integrations/github.ts";
import { DatadogOrgStore, PUP_CONFIG_DIR as HUI_PUP_CONFIG_DIR } from "../integrations/datadog.ts";
import { JIRA_CONFIG_FILE, JiraConfigStore } from "../integrations/jira.ts";
import { pupSite } from "../integrations/datadog-links.ts";
import type { DatadogOrg } from "../api/datadog.ts";
import { contentFile, type PlannedFile } from "./sync.ts";

/** A login file the worker's own CLI rewrites: every sync restores the gateway's copy, which stays authoritative. */
const loginFile = (path: string, content: Buffer): PlannedFile => ({ ...contentFile(path, content), mutable: true });

/** Mirror-relative directories the worker points `gh` and `pup` at. */
const GH_CONFIG_PATH = "hui/integrations/gh";
const PUP_CONFIG_PATH = "hui/integrations/pup";

const MAX_FILE_BYTES = 64 * 1024;
const GH_TIMEOUT_MS = 10_000;
/** Token variables a profile may export. gh uses them instead of its login store and names no account for them, so what
 * a worker is given is the store: the accounts the operator actually signed in to. */
const SHADOW_TOKENS = ["GH_TOKEN", "GITHUB_TOKEN", "GH_ENTERPRISE_TOKEN", "GITHUB_ENTERPRISE_TOKEN"];

export type IntegrationLogins = {
  files: PlannedFile[];
  /** Variables the worker sets in its own environment, so every shell an agent runs sees them. */
  env: Record<string, string>;
  /** What could not be shared, for Settings → Workers. */
  skipped: string[];
};

/** The one account per login, as gh writes them: a `users` map and the active account's own token. */
export function githubHostsFile(accounts: readonly { login: string; token: string }[], active?: string): string {
  const current = accounts.find((account) => account.login === active) ?? accounts[0];
  if (!current) return "";
  const lines = [`${GITHUB_HOST}:`, "    users:"];
  for (const account of accounts) lines.push(`        ${account.login}:`, `            oauth_token: ${account.token}`);
  lines.push(`    user: ${current.login}`, `    oauth_token: ${current.token}`);
  return `${lines.join("\n")}\n`;
}

/** A token gh printed, or undefined when the line is not one (a warning on stdout, say). */
const tokenLine = (output: string): string | undefined => /^[A-Za-z0-9_\-.]{8,}$/u.exec(output.trim())?.[0];

/** gh's output, even after a non-zero exit: `gh auth status` reports the accounts it found and still exits 1 when one of
 * them has expired, and filling a worker's hosts file from a partial answer beats revoking what it has. */
function ghRun(command: string, args: readonly string[], env: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { env, timeout: GH_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024, encoding: "utf8" }, (error, stdout) => {
      if (error && !stdout) reject(error);
      else resolve(stdout);
    });
  });
}

/** Every `gh` account the gateway is signed in to, with its token. Fails only when gh answers nothing (missing, or
 * not a login list). */
export async function githubAccounts(command: string, env: NodeJS.ProcessEnv): Promise<{ login: string; token: string; active: boolean }[]> {
  const login = { ...env };
  for (const name of SHADOW_TOKENS) delete login[name];
  const accounts = parseAccounts(await ghRun(command, ["auth", "status", "--hostname", GITHUB_HOST, "--json", "hosts"], login));
  const found: { login: string; token: string; active: boolean }[] = [];
  for (const account of accounts) {
    const token = await ghRun(command, ["auth", "token", "--hostname", GITHUB_HOST, "--user", account.login], login)
      .then(tokenLine, () => undefined);
    if (token) found.push({ ...account, token });
  }
  return found;
}

/** pup's own naming: a site's file is `tokens_<site>.json` with every non-alphanumeric character as `_`. */
const pupSiteFile = (site: string): string => pupSite(site).replace(/[^A-Za-z0-9]/gu, "_");

/** The key of an org inside its site's file: pup's `__default__` for the default session. */
const pupOrgKey = (org: DatadogOrg): string => org.name || "__default__";

/** One JSON file from pup's directory, parsed as the object pup writes. */
async function pupJson(dir: string, name: string): Promise<Record<string, unknown> | unknown[] | undefined> {
  const path = join(dir, name);
  const info = await stat(path).catch(() => undefined);
  if (!info?.isFile() || info.size > MAX_FILE_BYTES) return undefined;
  try {
    return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown> | unknown[];
  } catch {
    return undefined;
  }
}

const jsonFile = (name: string, value: unknown): PlannedFile => loginFile(`${PUP_CONFIG_PATH}/${name}`, Buffer.from(`${JSON.stringify(value, null, 2)}\n`));

/** The orgs of one session registry entry, as pup writes them (`org` is "" for the default session). */
const registryOrg = (entry: unknown): { site: string; org: string } | undefined => {
  const source = entry && typeof entry === "object" ? entry as Record<string, unknown> : undefined;
  return source && typeof source["site"] === "string" ? { site: source["site"], org: typeof source["org"] === "string" ? source["org"] : "" } : undefined;
};

/** The session files of the orgs HUI lists, and nothing else: one `tokens_<site>.json` keeping only their entries,
 * the site's client registration, and a registry naming them. A session HUI does not list is not shared, so the
 * worker reads exactly what Settings shows. Empty when pup keeps its tokens in a keychain. */
export async function pupFiles(dir: string, orgs: readonly DatadogOrg[]): Promise<PlannedFile[]> {
  const sites = new Map<string, Set<string>>();
  for (const org of orgs) {
    const name = pupSiteFile(org.site);
    sites.set(name, (sites.get(name) ?? new Set()).add(pupOrgKey(org)));
  }
  const files: PlannedFile[] = [];
  for (const [site, keys] of [...sites].toSorted(([a], [b]) => a.localeCompare(b))) {
    const tokens = await pupJson(dir, `tokens_${site}.json`);
    const kept = Object.fromEntries(Object.entries(tokens && !Array.isArray(tokens) ? tokens : {}).filter(([key]) => keys.has(key)));
    if (Object.keys(kept).length) files.push(jsonFile(`tokens_${site}.json`, kept));
    const client = await pupJson(dir, `client_${site}.json`);
    if (client) files.push(jsonFile(`client_${site}.json`, client));
  }
  const registry = await pupJson(dir, "sessions.json");
  const listed = (Array.isArray(registry) ? registry : []).filter((entry) => {
    const org = registryOrg(entry);
    return org !== undefined && sites.get(pupSiteFile(org.site))?.has(org.org || "__default__") === true;
  });
  if (listed.length) files.push(jsonFile("sessions.json", listed));
  return files;
}

/** Jira's token for the agent's Atlassian helper, which reads it from the environment on a machine with no keychain. */
export async function jiraEnv(file = JIRA_CONFIG_FILE): Promise<Record<string, string>> {
  const config = await new JiraConfigStore(file).read();
  if (!config) return {};
  const site = config.site.replace(/^https?:\/\//u, "").replace(/\/+$/u, "");
  return site ? { ATLASSIAN_API_TOKEN: config.token, ATLASSIAN_ACCOUNT: config.email, ATLASSIAN_SITE: site } : {};
}

/** Everything the gateway can share with one worker right now. Never rejects: what cannot be gathered is skipped. */
export async function gatherIntegrationLogins(options: {
  gh?: string;
  env?: NodeJS.ProcessEnv;
  pupDir?: string;
  orgs?: readonly DatadogOrg[];
  jiraFile?: string;
} = {}): Promise<IntegrationLogins> {
  const env = options.env ?? process.env;
  const files: PlannedFile[] = [];
  const skipped: string[] = [];

  const accounts = await githubAccounts(options.gh ?? "gh", env).catch(() => []);
  const active = accounts.find((account) => account.active)?.login;
  const hosts = githubHostsFile(accounts, active);
  if (hosts) files.push(loginFile(`${GH_CONFIG_PATH}/hosts.yml`, Buffer.from(hosts)));
  else skipped.push("GitHub: no saved gh login on the gateway to share");

  const orgs = options.orgs ?? await new DatadogOrgStore().read().catch(() => [] as DatadogOrg[]);
  const pup = await pupFiles(options.pupDir ?? HUI_PUP_CONFIG_DIR, orgs);
  // A session registry without a token signs nothing in; only share when pup has tokens to give.
  if (!orgs.length) skipped.push("Datadog: no orgs in Settings → Integrations → Datadog to share");
  else if (pup.some((file) => file.path.includes("/tokens_"))) files.push(...pup);
  else skipped.push("Datadog: pup has no token files on the gateway; sign in through Settings → Integrations → Datadog to share its orgs");

  const jira: Record<string, string> = await jiraEnv(options.jiraFile).catch(() => ({}));
  if (!jira["ATLASSIAN_API_TOKEN"]) skipped.push("Jira: not connected in Settings → Integrations → Jira");
  return { files, env: jira, skipped };
}
