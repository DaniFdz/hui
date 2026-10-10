import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createDiffRoutes, parseDiffRequest, REMOTE_DIFF_REASON } from "./diff-routes.ts";
import type { GitRunner } from "./git-diff.ts";

const isolated = { GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "test@example.invalid", GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "test@example.invalid" };
const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, env: { ...process.env, ...isolated }, encoding: "utf8" });

async function workspace() {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "hui-diff-routes-")));
  const cwd = join(dir, "work");
  await mkdir(cwd, { recursive: true });
  git(cwd, "init", "-q", "-b", "main");
  await writeFile(join(cwd, "a.txt"), "one\n");
  git(cwd, "add", "a.txt");
  git(cwd, "commit", "-q", "-m", "init");
  await writeFile(join(cwd, "a.txt"), "two\n");
  await writeFile(join(dir, "secret.txt"), "outside");
  await mkdir(join(dir, "plain"));
  return { dir, cwd };
}

test("a request names a comparison from the fixed list and a branch only as a full ref", () => {
  assert.deepEqual(parseDiffRequest(new URLSearchParams({ compare: "uncommitted" })), { comparison: "uncommitted", parent: undefined, uncommitted: true });
  assert.deepEqual(parseDiffRequest(new URLSearchParams({ compare: "parent", parent: "refs/heads/feature-a", uncommitted: "0" })), { comparison: "parent", parent: "refs/heads/feature-a", uncommitted: false });
  assert.throws(() => parseDiffRequest(new URLSearchParams({ compare: "HEAD~3" })), /Choose a comparison/u);
  for (const parent of ["--output=/tmp/x", "HEAD", "main", "refs/tags/v1", "refs/heads/a b", "refs/heads/x\0"]) {
    assert.throws(() => parseDiffRequest(new URLSearchParams({ compare: "parent", parent })), /previous branch|too long/u, parent);
  }
});

test("diff routes stay inside the conversation's directory and explain remote and non-Git sessions", async (t) => {
  const { dir, cwd } = await workspace();
  t.after(() => rm(dir, { recursive: true, force: true }));
  await symlink(join(dir, "secret.txt"), join(cwd, "escape.txt"));
  const sessions: Record<string, { cwd: string; worker?: string }> = {
    local: { cwd },
    remote: { cwd: "/srv/elsewhere", worker: "w1" },
    gone: { cwd: join(dir, "missing") },
    plain: { cwd: join(dir, "plain") },
  };
  const seen: string[][] = [];
  const recording: GitRunner = async (where, args, options) => {
    seen.push([...args]);
    const { runGit } = await import("./git-diff.ts");
    return runGit(where, args, { ...options, env: { ...options?.env, GIT_CEILING_DIRECTORIES: dir } });
  };
  const routes = createDiffRoutes({ session: async (id) => sessions[id], git: recording });
  const call = async (path: string, query: Record<string, string> = {}, method = "GET") => {
    const result = await routes.handle({ method, path, query: new URLSearchParams(query) });
    assert(result, "expected a result");
    return result as { status: number; body: Record<string, unknown> };
  };

  assert.equal(await routes.handle({ method: "GET", path: "/__hui/sessions/local/other", query: new URLSearchParams() }), undefined);
  assert.equal((await call("/__hui/sessions/nobody/diff")).status, 404);
  assert.equal((await call("/__hui/sessions/local/diff", {}, "POST")).status, 405);
  assert.deepEqual((await call("/__hui/sessions/remote/diff")).body, { available: false, reason: REMOTE_DIFF_REASON, code: "remote" });
  const remote = await call("/__hui/sessions/remote/diff/changes", { compare: "uncommitted" });
  assert.equal(remote.status, 409);
  assert.equal(remote.body["code"], "remote");
  assert.equal((await call("/__hui/sessions/gone/diff")).body["code"], "missing");
  assert.equal((await call("/__hui/sessions/plain/diff")).body["code"], "not-repo");

  const info = await call("/__hui/sessions/local/diff");
  assert.equal(info.body["available"], true);
  assert.equal(info.body["branch"], "main");
  const changes = await call("/__hui/sessions/local/diff/changes", { compare: "uncommitted" });
  assert.equal(changes.status, 200);
  const files = changes.body["files"] as { path: string; patch?: string }[];
  assert.deepEqual(files.map((file) => file.path), ["a.txt", "escape.txt"]);
  // A link is diffed as the link itself (its target path), never as the file outside it points to.
  const link = files.find((file) => file.path === "escape.txt")!;
  assert.match(link.patch ?? "", /secret\.txt/u);
  assert.doesNotMatch(link.patch ?? "", /outside/u);

  assert.equal((await call("/__hui/sessions/local/diff/changes", { compare: "bogus" })).status, 400);
  assert.equal((await call("/__hui/sessions/local/diff/changes", { compare: "parent", parent: "--upload-pack=touch /tmp/pwned" })).status, 400);
  assert.equal((await call("/__hui/sessions/local/diff/file", { compare: "uncommitted", path: "../secret.txt" })).status, 403);
  assert.equal((await call("/__hui/sessions/local/diff/file", { compare: "uncommitted", path: "/etc/passwd" })).status, 400);
  assert.equal((await call("/__hui/sessions/local/diff/file", { compare: "uncommitted", path: "a.txt", from: "../../x" })).status, 403);
  // Pathspec magic is literal: this names a file called ":(top)*", which does not exist.
  const magic = await call("/__hui/sessions/local/diff/file", { compare: "uncommitted", path: ":(top)*" });
  assert.equal(magic.status, 200);
  assert.equal(magic.body["file"], null);
  const one = await call("/__hui/sessions/local/diff/file", { compare: "uncommitted", path: "a.txt" });
  assert.match(String((one.body["file"] as { patch: string }).patch), /^\+two$/mu);

  // Every Git call disabled external programs and never wrote: no commit, checkout, reset, push or hook-running verb.
  const verbs = new Set(seen.map((args) => args.find((arg) => !arg.startsWith("-"))));
  for (const verb of verbs) assert.ok(["rev-parse", "symbolic-ref", "for-each-ref", "remote", "status", "log", "config", "diff", "ls-files", "add", "merge-base", "rev-list"].includes(verb!), String(verb));
  for (const args of seen.filter((args) => args[0] === "diff")) {
    for (const flag of ["--no-ext-diff", "--no-textconv", "--no-color"]) assert.ok(args.includes(flag), flag);
  }
});
