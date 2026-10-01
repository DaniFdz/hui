import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { CheckoutDiscovery, discoverCheckouts, discoverRepositories } from "./checkout-discovery.ts";
import type { Checkout } from "./my-pull-requests.ts";
import { runCommand } from "./worktree-inventory.ts";

const git = async (...args: string[]) => {
  const result = await runCommand("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args]);
  assert.equal(result.code, 0, result.stderr);
};
async function repo(path: string, remote?: string, branch = "main") {
  await git("init", "-q", "-b", branch, path);
  await git("-C", path, "commit", "-q", "--allow-empty", "-m", "init");
  if (remote) await git("-C", path, "remote", "add", "origin", remote);
}

test("discovers sibling clones, their worktrees and repositories inside plain directories", async (t) => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "hui-discovery-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  const projects = join(root, "projects");
  await repo(join(projects, "web"), "git@github.com:acme/web.git");
  await mkdir(join(projects, "web", "src"));
  await repo(join(projects, "billing"), "git@work.github.com:acme/billing.git");
  await git("-C", join(projects, "billing"), "worktree", "add", "-q", "-b", "feat/ci", join(root, "worktrees", "billing-ci"));
  await repo(join(projects, ".hidden"), "git@github.com:acme/hidden.git");
  await repo(join(projects, "node_modules"), "git@github.com:acme/modules.git");
  await mkdir(join(projects, "plain"));
  await repo(join(projects, "deep", "nested"), "git@github.com:acme/nested.git");
  await repo(join(projects, "gitlab"), "git@gitlab.com:acme/gitlab.git");
  await repo(join(root, "elsewhere", "linked"), "https://github.com/acme/linked.git");
  await symlink(join(root, "elsewhere", "linked"), join(projects, "link"));
  await repo(join(root, "scratch", "api"), "https://github.com/acme/api.git");
  await symlink(join(projects, "web"), join(root, "web-alias"));

  // A subdirectory of a repository, a symlinked alias of it, a plain
  // directory and a missing one.
  const cwds = [join(projects, "web", "src"), join(root, "web-alias"), join(root, "scratch"), join(root, "missing")];
  const repositories = await discoverRepositories(cwds, runCommand);
  assert.deepEqual(repositories, [
    join(projects, "web"),
    join(projects, "billing"),
    join(projects, "gitlab"),
    join(root, "elsewhere", "linked"),
    join(root, "scratch", "api"),
  ], "own top level first; depth 1 only; dot-dirs and node_modules skipped; symlinks resolved and de-duplicated");

  const checkouts = await discoverCheckouts(cwds, runCommand);
  assert.deepEqual(Object.fromEntries(checkouts), {
    [join(projects, "web")]: { branch: "main", repositories: ["acme/web"] },
    [join(projects, "billing")]: { branch: "main", repositories: ["acme/billing"] },
    [join(root, "worktrees", "billing-ci")]: { branch: "feat/ci", repositories: ["acme/billing"] },
    [join(root, "elsewhere", "linked")]: { branch: "main", repositories: ["acme/linked"] },
    [join(root, "scratch", "api")]: { branch: "main", repositories: ["acme/api"] },
  } satisfies Record<string, Checkout>, "worktrees carry their branch; non-GitHub repositories are dropped");

  assert.deepEqual(await discoverRepositories(cwds, runCommand, 2), [join(projects, "web"), join(projects, "billing")], "bounded");
});

test("discovery is cached, refreshed in the background and restarted for new directories", async () => {
  let now = 0;
  const calls: string[][] = [];
  let release: (() => void) | undefined;
  const discovery = new CheckoutDiscovery(async (cwds) => {
    calls.push([...cwds]);
    if (calls.length > 1) await new Promise<void>((resolve) => { release = resolve; });
    return new Map([[`/found/${calls.length}`, { branch: "main", repositories: ["acme/web"] }]]);
  }, { now: () => now, ttlMs: 60_000 });

  assert.deepEqual([...(await discovery.view(["/a"])).keys()], ["/found/1"], "the first view waits");
  assert.deepEqual([...(await discovery.view(["/a"])).keys()], ["/found/1"]);
  assert.equal(calls.length, 1, "fresh: no rediscovery");

  now = 60_000;
  assert.deepEqual([...(await discovery.view(["/a"])).keys()], ["/found/1"], "stale: served at once");
  assert.equal(calls.length, 2, "and rediscovered in the background");
  await discovery.view(["/a"]);
  assert.equal(calls.length, 2, "one rediscovery at a time");
  release?.();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual([...(await discovery.view(["/a"])).keys()], ["/found/2"]);

  const next = discovery.view(["/a", "/b"]);
  assert.deepEqual([...(await next).keys()], ["/found/2"], "new directories do not block");
  assert.deepEqual(calls.at(-1), ["/a", "/b"]);
  release?.();
});
