/**
 * Local checkouts near the session directories, so a pull request row can
 * start a session in a clone no session has used yet (zero configuration).
 *
 * Roots are every session directory, its Git top level and that top level's
 * parent. Each root's immediate child directories that hold `.git` are
 * repositories (dot-directories and `node_modules` are skipped); every
 * repository's worktrees are listed with their branches. Paths are resolved
 * through symlinks, repositories are bounded and the result is cached in
 * memory and refreshed in the background.
 */
import type { Dirent } from "node:fs";
import { readdir, realpath, stat } from "node:fs/promises";
import { dirname, join } from "node:path";

import { parseGitHubRemotes, type Checkout } from "./my-pull-requests.ts";
import { parseWorktreeList, type CommandRunner } from "./worktree-inventory.ts";

export const MAX_DISCOVERED_REPOSITORIES = 200;

const canonical = (path: string) => realpath(path).catch(() => undefined);
const holdsGit = (directory: string) => stat(join(directory, ".git")).then(() => true, () => false);

/** Canonical repository roots near `cwds`: their own top levels first, then
 * the repositories directly inside each root, at most `limit`. */
export async function discoverRepositories(cwds: readonly string[], run: CommandRunner, limit = MAX_DISCOVERED_REPOSITORIES): Promise<string[]> {
  const repositories = new Set<string>();
  const roots = new Set<string>();
  const places = await Promise.all([...new Set(cwds.filter(Boolean))].map(async (cwd) => {
    const directory = await canonical(cwd);
    if (!directory) return undefined;
    const top = await run("git", ["-C", directory, "rev-parse", "--show-toplevel"]);
    return { directory, topLevel: top.code === 0 ? await canonical(top.stdout.trim()) : undefined };
  }));
  for (const place of places) {
    if (!place) continue;
    roots.add(place.directory);
    if (!place.topLevel) continue;
    if (repositories.size < limit) repositories.add(place.topLevel);
    roots.add(place.topLevel);
    roots.add(dirname(place.topLevel));
  }
  for (const root of roots) {
    if (repositories.size >= limit) break;
    const entries = await readdir(root, { withFileTypes: true }).catch((): Dirent[] => []);
    const children = entries
      .filter((entry) => (entry.isDirectory() || entry.isSymbolicLink()) && !entry.name.startsWith(".") && entry.name !== "node_modules")
      .map((entry) => join(root, entry.name))
      .toSorted();
    const found = await Promise.all(children.map(async (child) => await holdsGit(child) ? canonical(child) : undefined));
    for (const repository of found) {
      if (repositories.size >= limit) break;
      if (repository) repositories.add(repository);
    }
  }
  return [...repositories];
}

/** Every worktree of the repositories near `cwds` that push to github.com,
 * keyed by canonical path, in discovery order. */
export async function discoverCheckouts(cwds: readonly string[], run: CommandRunner, limit = MAX_DISCOVERED_REPOSITORIES): Promise<Map<string, Checkout>> {
  const repositories = await discoverRepositories(cwds, run, limit);
  const perRepository = await Promise.all(repositories.map(async (repository) => {
    const [remotes, listed] = await Promise.all([
      run("git", ["-C", repository, "remote", "-v"]),
      run("git", ["-C", repository, "worktree", "list", "--porcelain", "-z"]),
    ]);
    const names = remotes.code === 0 ? parseGitHubRemotes(remotes.stdout) : [];
    if (!names.length || listed.code !== 0) return [];
    const worktrees = parseWorktreeList(listed.stdout).filter((worktree) => !worktree.bare && !worktree.prunable);
    return Promise.all(worktrees.map(async (worktree) => ({ path: await canonical(worktree.path), checkout: { branch: worktree.branch, repositories: names } })));
  }));
  const found = new Map<string, Checkout>();
  for (const { path, checkout } of perRepository.flat()) {
    if (path && !found.has(path)) found.set(path, checkout);
  }
  return found;
}

/** Stale-while-revalidate discovery: only the first `view` waits; later ones
 * return the last result and rediscover in the background once it is older
 * than the TTL or the session directories changed. */
export class CheckoutDiscovery {
  readonly #discover: (cwds: readonly string[]) => Promise<Map<string, Checkout>>;
  readonly #now: () => number;
  readonly #ttl: number;
  #value?: Map<string, Checkout>;
  #key = "";
  #freshUntil = 0;
  #running?: Promise<void>;

  constructor(discover: (cwds: readonly string[]) => Promise<Map<string, Checkout>>, options: { now?: () => number; ttlMs?: number } = {}) {
    this.#discover = discover;
    this.#now = options.now ?? Date.now;
    this.#ttl = options.ttlMs ?? 60_000;
  }

  async view(cwds: readonly string[]): Promise<Map<string, Checkout>> {
    const key = [...new Set(cwds)].toSorted().join("\0");
    if (!this.#value) await this.#start(cwds, key);
    else if (!this.#running && (this.#freshUntil <= this.#now() || key !== this.#key)) void this.#start(cwds, key);
    return this.#value ?? new Map();
  }

  #start(cwds: readonly string[], key: string): Promise<void> {
    this.#running ??= this.#discover(cwds).then(
      (value) => { this.#value = value; this.#key = key; },
      // Discovery is best effort: without it only session directories count.
      () => { this.#value ??= new Map(); this.#key = key; },
    ).finally(() => {
      this.#freshUntil = this.#now() + this.#ttl;
      this.#running = undefined;
    });
    return this.#running;
  }
}
