/** A year of commits and pull requests for every `gh` account on github.com:
 * the rolling last year, or one calendar year.
 *
 * GitHub's contribution calendar API returns nothing for Enterprise Managed
 * Users, so this reads GitHub search instead: commits the account authored
 * (search indexes default branches) and pull requests it opened. The active
 * account runs `gh` as-is. Another account's token comes from
 * `gh auth token --user` and goes only into that `gh` child's `GH_TOKEN`; it is
 * never logged, cached or sent to the browser. Results live in gateway memory.
 */
import { execFile } from "node:child_process";

import type { GitHubContributionAccount, GitHubContributions } from "../shared/github.ts";
import { GH_ENV, GITHUB_HOST, spawnFailure } from "./github.ts";

const DAY_MS = 86_400_000;
/** Covers the 53 calendar weeks the page draws in any browser time zone. */
const WINDOW_DAYS = 372;
/** GitHub launched in 2008; no account has earlier activity. */
export const FIRST_YEAR = 2008;
/** GitHub search never returns more than 1000 results for one query. */
const SEARCH_CAP = 1000;
const PAGE_SIZE = 100;
const CACHE_MS = 15 * 60_000;

const SEARCHES = {
  // `range` is both the date qualifier and the sort, so later pages continue page one.
  commits: { path: "search/commits", qualifier: "", range: "author-date", date: ".commit.author.date" },
  pullRequests: { path: "search/issues", qualifier: " is:pr", range: "created", date: ".created_at" },
} as const;

type Kind = keyof typeof SEARCHES;
type Run = (args: string[], env?: Record<string, string>) => Promise<string>;

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const addDays = (value: string, days: number) => day(Date.parse(value) + days * DAY_MS);
const lines = (text: string) => text.split("\n").map((line) => line.trim()).filter(Boolean);

/** `gh auth status --json hosts` → the github.com logins, active first. */
function parseAccounts(stdout: string): { login: string; active: boolean }[] {
  const hosts = (JSON.parse(stdout) as { hosts?: Record<string, unknown> }).hosts;
  const entries = hosts?.[GITHUB_HOST];
  if (!Array.isArray(entries)) return [];
  return entries
    .map((entry: { login?: unknown; active?: unknown }) => ({ login: typeof entry?.login === "string" ? entry.login : "", active: entry?.active === true }))
    .filter((account) => /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/u.test(account.login))
    .sort((a, b) => Number(b.active) - Number(a.active));
}

export class GitHubContributionsReader {
  readonly #run: Run;
  readonly #now: () => number;
  readonly #cache = new Map<number | undefined, { at: number; value: Promise<GitHubContributions> }>();

  constructor(command = "gh", env: NodeJS.ProcessEnv = process.env, now: () => number = Date.now) {
    this.#now = now;
    this.#run = (args, extra) => new Promise((resolve, reject) => {
      execFile(command, args, { env: { ...env, ...GH_ENV, ...extra }, timeout: 90_000, maxBuffer: 4 * 1024 * 1024, encoding: "utf8" }, (error, stdout, stderr) => {
        if (error) reject(new Error(spawnFailure(Object.assign(error, { stderr }))));
        else resolve(stdout);
      });
    });
  }

  /** `year` omitted: the last year. Each range is cached for 15 minutes and
   * concurrent readers share one fetch. Failures and "no account" are not
   * kept, so a fresh `gh` sign-in shows up at once. */
  read(year?: number, refresh = false): Promise<GitHubContributions> {
    const now = this.#now();
    const cached = this.#cache.get(year);
    if (!refresh && cached && now - cached.at <= CACHE_MS) return cached.value;
    const entry = { at: now, value: this.#load(now, year) };
    this.#cache.set(year, entry);
    const forget = () => { if (this.#cache.get(year) === entry) this.#cache.delete(year); };
    entry.value.then((value) => { if (value.accounts.length === 0) forget(); }, forget);
    return entry.value;
  }

  async #load(now: number, year?: number): Promise<GitHubContributions> {
    const today = day(now);
    // A calendar year gains a day each side so every browser time zone sees all of it.
    const from = year === undefined ? addDays(today, 1 - WINDOW_DAYS) : `${year - 1}-12-31`;
    const to = year === undefined || `${year + 1}-01-01` > today ? today : `${year + 1}-01-01`;
    const accounts = parseAccounts(await this.#run(["auth", "status", "--hostname", GITHUB_HOST, "--json", "hosts"]));
    return { accounts: await Promise.all(accounts.map((account) => this.#account(account, from, to))) };
  }

  async #account({ login, active }: { login: string; active: boolean }, from: string, to: string): Promise<GitHubContributionAccount> {
    try {
      const env = active ? undefined : { GH_TOKEN: (await this.#run(["auth", "token", "--hostname", GITHUB_HOST, "--user", login])).trim() };
      const [createdAt, commits, pullRequests] = await Promise.all([
        this.#run(["api", "user", "--jq", ".created_at"], env).then((output) => output.trim()),
        this.#search("commits", login, from, to, env),
        this.#search("pullRequests", login, from, to, env),
      ]);
      return { login, createdAt, commits, pullRequests };
    } catch (error) {
      return { login, commits: [], pullRequests: [], error: error instanceof Error ? error.message : String(error) };
    }
  }

  /** Dates of every match in `from..to`, halving ranges that exceed the search cap. */
  async #search(kind: Kind, login: string, from: string, to: string, env?: Record<string, string>): Promise<string[]> {
    const search = SEARCHES[kind];
    const args = (jq: string, ...extra: string[]) => [
      "api", "-X", "GET", search.path,
      "-f", `q=author:${login}${search.qualifier} ${search.range}:${from}..${to}`,
      "-f", `sort=${search.range}`, "-f", `per_page=${PAGE_SIZE}`, ...extra, "--jq", jq,
    ];
    const [total = "0", ...dates] = lines(await this.#run(args(`.total_count, (.items[] | ${search.date})`), env));
    const count = Number(total);
    if (count > SEARCH_CAP && from < to) {
      const middle = addDays(from, Math.floor((Date.parse(to) - Date.parse(from)) / DAY_MS / 2));
      const halves = await Promise.all([this.#search(kind, login, from, middle, env), this.#search(kind, login, addDays(middle, 1), to, env)]);
      return halves.flat();
    }
    if (count <= PAGE_SIZE) return dates;
    return [...dates, ...lines(await this.#run(args(`.items[] | ${search.date}`, "-f", "page=2", "--paginate"), env))];
  }
}
