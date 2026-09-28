import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import {
  commandOutput,
  delegationPrompt,
  displayCommand,
  redactCredentials,
  normalizeCommitMessage,
  parseNameStatus,
  parseNumstat,
  parsePullRequestDraft,
  parseStatus,
  runCommand,
  sessionEditedPaths,
  SessionChangesService,
  ShipInputError,
  ShipStepError,
  type CommandRunner,
} from "./session-changes.ts";
import { changesReady, defaultShipSelection } from "../shared/session-changes.ts";
import type { TranscriptEntry } from "./runtimes/types.ts";
import changesProposalExtension from "./runtimes/changes-proposal-extension.mjs";
import { huiToolDefinitions } from "./runtimes/hui-tools.ts";
import { CHANGES_DECISION_TITLE } from "../shared/session-changes.ts";

let root: string;
let repo: string;
let remote: string;

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" } }).trim();

type GhCall = readonly string[];
function fakeGh(options: { list?: unknown[]; create?: { code: number; stdout: string; stderr?: string } } = {}) {
  const calls: GhCall[] = [];
  const run: CommandRunner = async (command, args, opts) => {
    if (command !== "gh") return runCommand(command, args, opts);
    calls.push(args);
    if (args[0] === "pr" && args[1] === "list") {
      // Like `gh pr list --head`: entries with a headRefName only match their branch.
      const head = args[args.indexOf("--head") + 1];
      const list = (options.list ?? []).filter((entry) => !(entry as { headRefName?: string }).headRefName || (entry as { headRefName?: string }).headRefName === head);
      return { code: 0, stdout: JSON.stringify(list), stderr: "" };
    }
    if (args[0] === "pr" && args[1] === "create") return { stderr: "", ...(options.create ?? { code: 0, stdout: "https://github.com/acme/web/pull/42\n" }) };
    return { code: 1, stdout: "", stderr: "unsupported" };
  };
  return { calls, run };
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "hui-changes-"));
  remote = join(root, "remote.git");
  repo = join(root, "repo");
  process.env["GIT_CONFIG_GLOBAL"] = "/dev/null";
  process.env["GIT_AUTHOR_NAME"] = process.env["GIT_COMMITTER_NAME"] = "HUI Test";
  process.env["GIT_AUTHOR_EMAIL"] = process.env["GIT_COMMITTER_EMAIL"] = "hui@test.invalid";
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", remote]);
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  await writeFile(join(repo, "a.txt"), "one\ntwo\n");
  await writeFile(join(repo, "b.txt"), "b\n");
  git(repo, "add", ".");
  git(repo, "commit", "-qm", "init");
  git(repo, "remote", "add", "origin", remote);
  git(repo, "push", "-q", "-u", "origin", "main");
  git(repo, "remote", "set-head", "origin", "main");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("parsers", () => {
  it("reads porcelain, numstat and name-status records", () => {
    assert.deepEqual([...parseStatus(" M a.txt\0?? new file.txt\0D  gone.txt\0")], [["a.txt", " M"], ["new file.txt", "??"], ["gone.txt", "D "]]);
    assert.deepEqual(parseNumstat("3\t1\ta.txt\0-\t-\timg.png\0").get("img.png"), { additions: 0, deletions: 0, binary: true });
    assert.deepEqual([...parseNameStatus("A\0n.txt\0D\0g.txt\0M\0a.txt\0")], [["n.txt", "added"], ["g.txt", "deleted"], ["a.txt", "modified"]]);
  });

  it("normalizes model output", () => {
    assert.equal(normalizeCommitMessage("```\nCommit message: \"Add hero\"\n\nBody line\n```"), "Add hero\n\nBody line");
    assert.deepEqual(parsePullRequestDraft("Sure: {\"title\": \" Add  hero \", \"body\": \"## Summary\"}"), { title: "Add hero", body: "## Summary" });
    assert.equal(parsePullRequestDraft("no json"), undefined);
  });

  it("collects paths written by edit tools only", () => {
    const entries: TranscriptEntry[] = [
      { kind: "tool", id: "1", name: "edit", args: { path: "src/a.ts" }, output: "ok" },
      { kind: "tool", id: "2", name: "Write", args: { file_path: "/abs/b.ts" }, output: "ok" },
      { kind: "tool", id: "3", name: "edit", args: { path: "failed.ts" }, output: "x", failed: true },
      { kind: "tool", id: "4", name: "read", args: { path: "read.ts" }, output: "ok" },
      { kind: "tool", id: "5", name: "edit", args: { path: "pending.ts" } },
    ];
    assert.deepEqual([...sessionEditedPaths(entries, "/w")], ["/w/src/a.ts", "/abs/b.ts"]);
  });
});

describe("propose_changes", () => {
  type Tool = { name: string; execute: (...args: unknown[]) => Promise<{ content: Array<{ text: string }>; details: Record<string, unknown> }> };
  const tool = () => {
    let registered: Tool | undefined;
    changesProposalExtension({ registerTool: (definition) => { registered = definition as unknown as Tool; } });
    return registered!;
  };
  const params = { action: "pr", commitMessage: "Add hero", prTitle: "Add hero" };

  it("waits on HUI's decision request and returns the operator's answer", async () => {
    const requests: Array<{ title: string; placeholder: string | undefined; signal: AbortSignal | undefined }> = [];
    let answer!: (value: string | undefined) => void;
    const ctx = { hasUI: true, ui: { input: (title: string, placeholder?: string, opts?: { signal?: AbortSignal }) => {
      requests.push({ title, placeholder, signal: opts?.signal });
      return new Promise<string | undefined>((resolve) => { answer = resolve; });
    } } };
    const signal = new AbortController().signal;
    let settled = false;
    const running = tool().execute("call-1", params, signal, undefined, ctx).then((result) => { settled = true; return result; });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(settled, false, "the call blocks like a question");
    assert.deepEqual(requests, [{ title: CHANGES_DECISION_TITLE, placeholder: JSON.stringify(params), signal }]);
    answer(JSON.stringify({ outcome: "shipped", summary: "Opened draft pull request #42.", result: { pullRequest: { number: 42, url: "https://github.com/acme/web/pull/42" } } }));
    const result = await running;
    assert.match(result.content[0]!.text, /shipped the change .*#42/u);
    assert.deepEqual(result.details["decision"], { outcome: "shipped", summary: "Opened draft pull request #42.", result: { pullRequest: { number: 42, url: "https://github.com/acme/web/pull/42" } } });
    assert.equal(result.details["commitMessage"], "Add hero");
  });

  it("treats a stopped run as dismissed and never blocks without an operator interface", async () => {
    const stopped = await tool().execute("call-2", params, undefined, undefined, { hasUI: true, ui: { input: async () => undefined } });
    assert.deepEqual(stopped.details["decision"], { outcome: "dismissed" });
    const headless = await tool().execute("call-3", params, undefined, undefined, { hasUI: false, ui: { input: () => { throw new Error("must not ask"); } } });
    assert.match(headless.content[0]!.text, /nothing was shown or shipped/u);
  });

  it("is not registered when the changes card is off", () => {
    assert.ok(huiToolDefinitions().some((definition) => definition.name === "propose_changes"));
    assert.equal(huiToolDefinitions({ changes: false }).some((definition) => definition.name === "propose_changes"), false);
  });
});

describe("SessionChangesService.inspect", () => {
  it("reports unavailable outside a repository", async () => {
    const outside = join(root, "plain");
    await mkdir(outside);
    assert.deepEqual(await new SessionChangesService({ run: fakeGh().run }).inspect(outside), { available: false });
  });

  it("lists uncommitted and committed branch changes against the base", async () => {
    git(repo, "switch", "-qc", "feat/hero");
    await writeFile(join(repo, "a.txt"), "one\ntwo\nthree\n");
    git(repo, "commit", "-qam", "extend a");
    await writeFile(join(repo, "b.txt"), "B\n");
    await writeFile(join(repo, "new.txt"), "x\ny\n");
    const service = new SessionChangesService({ run: fakeGh().run });
    const changes = await service.inspect(repo, new Set([join(repo, "new.txt")]));
    assert.ok(changes.available);
    assert.equal(changes.branch, "feat/hero");
    assert.equal(changes.base, "main");
    assert.equal(changes.commits, 1);
    assert.equal(changes.unpushed, 1, "a branch without upstream counts its commits as unpushed");
    assert.deepEqual(changes.files.map(({ path, status, additions, deletions, uncommitted, session }) => ({ path, status, additions, deletions, uncommitted, session })), [
      { path: "new.txt", status: "added", additions: 2, deletions: 0, uncommitted: true, session: true },
      { path: "b.txt", status: "modified", additions: 1, deletions: 1, uncommitted: true, session: false },
      { path: "a.txt", status: "modified", additions: 1, deletions: 0, uncommitted: false, session: false },
    ], "session-written, then other uncommitted, then committed");
    assert.equal(changes.additions, 4);
    assert.equal(changes.totalFiles, 3);
    assert.equal(changesReady(changes), false, "nothing is offered until the agent asks in propose_changes");
    assert.ok(changesReady({ ...changes, proposal: { commitMessage: "Add new", key: "k" } }));
    assert.deepEqual(defaultShipSelection(changes), ["new.txt"], "session-owned files are preselected");
  });

  it("counts a branch pushed without upstream as pushed", async () => {
    git(repo, "switch", "-qc", "feat/agent-pushed");
    await writeFile(join(repo, "a.txt"), "agent\n");
    git(repo, "commit", "-qam", "Agent change");
    // What agents usually run before `gh pr create`: no --set-upstream.
    git(repo, "push", "-q", "origin", "feat/agent-pushed");
    const gh = fakeGh({ list: [{ number: 9, url: "https://github.com/acme/web/pull/9", title: "Agent change", isDraft: false, headRefOid: git(repo, "rev-parse", "HEAD") }] });
    const service = new SessionChangesService({ run: gh.run });
    const changes = await service.inspect(repo);
    assert.ok(changes.available);
    assert.equal(changes.upstream, undefined);
    assert.equal(changes.commits, 1);
    assert.equal(changes.unpushed, 0, "the remote-tracking ref has the commit");

    await writeFile(join(repo, "a.txt"), "agent, again\n");
    git(repo, "commit", "-qam", "Follow-up");
    const ahead = await service.inspect(repo);
    assert.ok(ahead.available);
    assert.equal(ahead.unpushed, 1, "only the commit after the push");
  });

  it("uses the pull request head when the checkout does not track the pushed branch", async () => {
    git(repo, "switch", "-qc", "feat/untracked-remote");
    await writeFile(join(repo, "a.txt"), "narrow\n");
    git(repo, "commit", "-qam", "Narrow refspec");
    git(repo, "push", "-q", "origin", "HEAD:refs/heads/feat/untracked-remote");
    git(repo, "update-ref", "-d", "refs/remotes/origin/feat/untracked-remote");
    const pushed = git(repo, "rev-parse", "HEAD");
    const service = new SessionChangesService({ run: fakeGh({ list: [{ number: 11, url: "https://github.com/acme/web/pull/11", title: "Narrow", isDraft: false, headRefOid: pushed }] }).run });
    const changes = await service.inspect(repo);
    assert.ok(changes.available);
    assert.equal(changes.unpushed, 0);
    await writeFile(join(repo, "b.txt"), "later\n");
    git(repo, "commit", "-qam", "Later");
    const ahead = await service.inspect(repo);
    assert.ok(ahead.available);
    assert.equal(ahead.unpushed, 1, "counts from the pull request head");
    const unknownHead = new SessionChangesService({ run: fakeGh({ list: [{ number: 11, url: "u", title: "t", isDraft: false, headRefOid: "f".repeat(40) }] }).run });
    const fallback = await unknownHead.inspect(repo);
    assert.ok(fallback.available);
    assert.equal(fallback.unpushed, 2, "an unknown head falls back to every branch commit");
  });

  it("looks the pull request up again after a push instead of trusting a cached miss", async () => {
    git(repo, "switch", "-qc", "feat/later-pr");
    await writeFile(join(repo, "a.txt"), "later pr\n");
    git(repo, "commit", "-qam", "Later PR");
    const options: { list: unknown[] } = { list: [] };
    const gh = fakeGh(options);
    const service = new SessionChangesService({ run: gh.run });
    const before = await service.inspect(repo);
    assert.ok(before.available);
    assert.equal(before.pullRequest, undefined);
    assert.equal(before.unpushed, 1);
    git(repo, "push", "-q", "origin", "feat/later-pr");
    options.list = [{ number: 12, url: "https://github.com/acme/web/pull/12", title: "Later PR", isDraft: true }];
    const after = await service.inspect(repo);
    assert.ok(after.available);
    assert.equal(after.pullRequest?.number, 12);
    assert.equal(after.unpushed, 0);
    assert.notEqual(after.signature, before.signature);
    const lookups = gh.calls.filter((args) => args[1] === "list").length;
    await service.inspect(repo);
    assert.equal(gh.calls.filter((args) => args[1] === "list").length, lookups, "an unchanged branch reuses the cache");
  });

  it("lists at most 200 files, keeping the session's and uncommitted ones, and reports the total", async () => {
    git(repo, "switch", "-qc", "feat/many");
    await writeFile(join(repo, "b.txt"), "committed on the branch\n");
    git(repo, "commit", "-qam", "branch commit");
    await mkdir(join(repo, "gen"));
    for (let index = 0; index < 205; index += 1) await writeFile(join(repo, "gen", `f${String(index).padStart(3, "0")}.txt`), "x\n");
    await writeFile(join(repo, "zz-own.txt"), "mine\n");
    const changes = await new SessionChangesService({ run: fakeGh().run }).inspect(repo, new Set([join(repo, "zz-own.txt")]));
    assert.ok(changes.available);
    assert.equal(changes.files.length, 200);
    assert.equal(changes.totalFiles, 207);
    assert.equal(changes.files[0]!.path, "zz-own.txt", "session files survive the cap");
    assert.equal(changes.files.some((file) => file.path === "b.txt"), false, "committed files are dropped first");
    assert.deepEqual(defaultShipSelection(changes), ["zz-own.txt"]);
  });

  it("is not ready on a clean default branch and keeps a stable signature", async () => {
    const service = new SessionChangesService({ run: fakeGh().run });
    const first = await service.inspect(repo);
    assert.equal(changesReady(first), false);
    assert.ok(first.available);
    assert.equal((await service.inspect(repo) as typeof first).signature, first.signature);
    await writeFile(join(repo, "a.txt"), "changed\n");
    const changed = await service.inspect(repo);
    assert.ok(changed.available && changed.signature !== first.signature);
    assert.deepEqual(defaultShipSelection(changed), ["a.txt"], "falls back to every uncommitted file");
  });

  it("returns a file diff, including untracked files, and rejects unlisted paths", async () => {
    await writeFile(join(repo, "a.txt"), "one\n2\n");
    await writeFile(join(repo, "n.txt"), "fresh\n");
    const service = new SessionChangesService({ run: fakeGh().run });
    const tracked = await service.diff(repo, "a.txt");
    assert.match(tracked.diff, /^-two$/mu);
    assert.match(tracked.diff, /^\+2$/mu);
    assert.match((await service.diff(repo, "n.txt")).diff, /^\+fresh$/mu);
    await assert.rejects(service.diff(repo, "../etc/passwd"), ShipInputError);
  });
});

describe("SessionChangesService.ship", () => {
  it("commits only the selected files and leaves other work untouched", async () => {
    await writeFile(join(repo, "a.txt"), "mine\n");
    await writeFile(join(repo, "b.txt"), "theirs\n");
    git(repo, "add", "b.txt");
    await writeFile(join(repo, "mine.txt"), "new\n");
    await writeFile(join(repo, "other.txt"), "other\n");
    const service = new SessionChangesService({ run: fakeGh().run });
    const result = await service.ship({ cwd: repo, action: "commit", files: ["a.txt", "mine.txt"], message: "Update mine", branchPrefix: "feature/" });
    assert.equal(result.commit?.subject, "Update mine");
    assert.equal(result.pushed, undefined);
    assert.deepEqual(git(repo, "show", "--name-only", "--format=", "HEAD").split("\n"), ["a.txt", "mine.txt"]);
    assert.equal(git(repo, "status", "--porcelain"), "M  b.txt\n?? other.txt".trim());
  });

  it("uses the writer for the commit message and falls back when it fails", async () => {
    await writeFile(join(repo, "a.txt"), "x\n");
    const prompts: string[] = [];
    const service = new SessionChangesService({ run: fakeGh().run });
    await service.ship({ cwd: repo, action: "commit", files: ["a.txt"], branchPrefix: "feature/", writer: async (prompt) => { prompts.push(prompt); return "Rewrite a.txt"; } });
    assert.equal(git(repo, "log", "-1", "--format=%s"), "Rewrite a.txt");
    assert.match(prompts[0]!, /-one/u);
    await writeFile(join(repo, "b.txt"), "y\n");
    await service.ship({ cwd: repo, action: "commit", files: ["b.txt"], branchPrefix: "feature/", writer: async () => { throw new Error("no model"); } });
    assert.equal(git(repo, "log", "-1", "--format=%s"), "Update b.txt");
  });

  it("commits and pushes, setting upstream for a new branch", async () => {
    git(repo, "switch", "-qc", "feat/push");
    await writeFile(join(repo, "a.txt"), "pushed\n");
    const service = new SessionChangesService({ run: fakeGh().run });
    const result = await service.ship({ cwd: repo, action: "commit_push", files: ["a.txt"], message: "Push it", branchPrefix: "feature/" });
    assert.equal(result.pushed, true);
    assert.equal(git(remote, "log", "-1", "--format=%s", "feat/push"), "Push it");
    assert.equal(git(repo, "rev-parse", "--abbrev-ref", "@{upstream}"), "origin/feat/push");
  });

  it("opens a draft pull request from the default branch on a new feature branch", async () => {
    await writeFile(join(repo, "a.txt"), "hero\n");
    const gh = fakeGh();
    const service = new SessionChangesService({ run: gh.run });
    const result = await service.ship({
      cwd: repo, action: "draft_pr", files: ["a.txt"], branchPrefix: "feature/",
      writer: async (prompt) => prompt.startsWith("Draft a GitHub") ? "{\"title\":\"Add hero\",\"body\":\"## Summary\\nHero.\"}" : "Add marketing hero",
    });
    assert.equal(result.createdBranch, "feature/add-marketing-hero");
    assert.equal(result.pushed, true);
    assert.deepEqual(result.pullRequest, { number: 42, url: "https://github.com/acme/web/pull/42" });
    assert.equal(git(remote, "log", "-1", "--format=%s", "feature/add-marketing-hero"), "Add marketing hero");
    assert.equal(git(repo, "rev-parse", "main"), git(remote, "rev-parse", "main"), "main is not moved or pushed");
    const create = gh.calls.find((args) => args[1] === "create")!;
    assert.deepEqual(create, ["pr", "create", "--draft", "--base", "main", "--head", "feature/add-marketing-hero", "--title", "Add hero", "--body", "## Summary\nHero."]);
  });

  it("uses the provided pull request title and body instead of drafting them", async () => {
    await writeFile(join(repo, "a.txt"), "proposed\n");
    const gh = fakeGh();
    const prompts: string[] = [];
    const service = new SessionChangesService({ run: gh.run });
    await service.ship({
      cwd: repo, action: "draft_pr", files: ["a.txt"], branchPrefix: "feature/",
      message: "Tune hero copy", prTitle: "Tune  the hero copy", prBody: "## Summary\nShorter.",
      writer: async (prompt) => { prompts.push(prompt); return "unused"; },
    });
    assert.equal(prompts.length, 0, "no model call when everything was provided");
    const create = gh.calls.find((args) => args[1] === "create")!;
    assert.deepEqual(create.slice(-4), ["--title", "Tune the hero copy", "--body", "## Summary\nShorter."]);
    assert.equal(git(remote, "log", "-1", "--format=%s", "feature/tune-hero-copy"), "Tune hero copy");
  });

  it("returns an existing pull request instead of creating another", async () => {
    git(repo, "switch", "-qc", "feat/open");
    const gh = fakeGh({ list: [{ number: 7, url: "https://github.com/acme/web/pull/7", title: "Open", isDraft: true }] });
    const service = new SessionChangesService({ run: gh.run });
    const changes = await service.inspect(repo);
    assert.ok(changes.available);
    assert.deepEqual(changes.pullRequest, { number: 7, url: "https://github.com/acme/web/pull/7", title: "Open", draft: true });
    const result = await service.ship({ cwd: repo, action: "draft_pr", files: [], branchPrefix: "feature/" });
    assert.deepEqual(result.pullRequest, { number: 7, url: "https://github.com/acme/web/pull/7", existing: true });
    assert.equal(gh.calls.some((args) => args[1] === "create"), false);
  });

  it("stacks a draft pull request on the open one, pushing the parent's commits first", async () => {
    git(repo, "switch", "-qc", "feat/base");
    await writeFile(join(repo, "b.txt"), "base\n");
    git(repo, "commit", "-qam", "Base change");
    git(repo, "push", "-q", "-u", "origin", "feat/base");
    await writeFile(join(repo, "b.txt"), "base, amended\n");
    git(repo, "commit", "-qam", "Address review");
    await writeFile(join(repo, "a.txt"), "stacked\n");
    const gh = fakeGh({ list: [{ number: 7, url: "https://github.com/acme/web/pull/7", title: "Base", isDraft: false, headRefName: "feat/base" }] });
    const prompts: string[] = [];
    const service = new SessionChangesService({ run: gh.run });
    const result = await service.ship({
      cwd: repo, action: "stacked_pr", files: ["a.txt"], branchPrefix: "feature/", message: "Build on base",
      writer: async (prompt) => { prompts.push(prompt); return "{\"title\":\"Build on base\",\"body\":\"Stacked.\"}"; },
    });
    assert.deepEqual(result.stackedOn, { branch: "feat/base", number: 7, pushed: true });
    assert.equal(result.createdBranch, "feature/build-on-base");
    assert.equal(git(repo, "rev-parse", "--abbrev-ref", "HEAD"), "feature/build-on-base");
    assert.equal(git(remote, "log", "-1", "--format=%s", "feat/base"), "Address review", "the parent's unpushed commit went to its own PR");
    assert.equal(git(remote, "log", "-1", "--format=%s", "feature/build-on-base"), "Build on base");
    assert.equal(git(remote, "rev-parse", "feature/build-on-base~1"), git(remote, "rev-parse", "feat/base"));
    assert.equal(prompts.length, 1);
    assert.doesNotMatch(prompts[0]!, /Address review/u, "the drafted body only covers the stacked commits");
    const create = gh.calls.find((args) => args[1] === "create")!;
    assert.deepEqual(create, ["pr", "create", "--draft", "--base", "feat/base", "--head", "feature/build-on-base", "--title", "Build on base", "--body", "Stacked."]);
  });

  it("refuses to stack without an open pull request or selected files", async () => {
    git(repo, "switch", "-qc", "feat/lonely");
    await writeFile(join(repo, "a.txt"), "x\n");
    const service = new SessionChangesService({ run: fakeGh().run });
    await assert.rejects(service.ship({ cwd: repo, action: "stacked_pr", files: ["a.txt"], branchPrefix: "feature/" }), ShipInputError);
    const withPr = new SessionChangesService({ run: fakeGh({ list: [{ number: 7, url: "u", title: "t", isDraft: true }] }).run });
    await assert.rejects(withPr.ship({ cwd: repo, action: "stacked_pr", files: [], branchPrefix: "feature/" }), /Select the files/u);
  });

  it("hands a failed stack over with the parent branch", () => {
    const error = new ShipStepError("branch", "Could not create branch", { branch: "feat/base", stackedOn: { branch: "feat/base", number: 7, pushed: true } });
    const prompt = delegationPrompt({ action: "stacked_pr", files: ["a.txt"], prTitle: "Build", error });
    assert.match(prompt, /open a stacked draft pull request/u);
    assert.match(prompt, /- Pushed `feat\/base` \(pull request #7\)\./u);
    assert.match(prompt, /create a new branch from `feat\/base`/u);
    assert.match(prompt, /--base feat\/base/u);
    assert.match(prompt, /Requested pull request title: Build/u);
  });

  it("reports a failed push as a step error with the completed commit", async () => {
    git(repo, "switch", "-qc", "feat/reject");
    await writeFile(join(remote, "hooks", "pre-receive"), [
      "#!/bin/sh",
      "echo 'This repository moved. Please use the new location:' >&2",
      "echo '  https://x-access-token:s3cret@github.com/example-org/web.git' >&2",
      "echo 'error: protected by policy' >&2",
      "exit 1",
      "",
    ].join("\n"), { mode: 0o755 });
    await writeFile(join(repo, "a.txt"), "z\n");
    const service = new SessionChangesService({ run: fakeGh().run });
    const error = await service.ship({ cwd: repo, action: "commit_push", files: ["a.txt"], message: "Blocked", branchPrefix: "feature/" }).catch((caught: unknown) => caught);
    assert.ok(error instanceof ShipStepError);
    assert.equal(error.step, "push");
    assert.equal(error.message, "remote: error: protected by policy");
    assert.equal(error.result.commit?.subject, "Blocked");
    // The agent gets the exact command and the full output, not just the first error line.
    assert.equal(error.command, "git push --set-upstream origin HEAD:refs/heads/feat/reject");
    assert.match(error.output ?? "", /remote: This repository moved\. Please use the new location:\nremote:\s+https:\/\/\*\*\*@github\.com\/example-org\/web\.git/u);
    assert.doesNotMatch(error.output ?? "", /s3cret/u);
    const prompt = delegationPrompt({ action: "commit_push", files: ["a.txt"], error });
    assert.match(prompt, /stopped at the push step/u);
    assert.match(prompt, /Command HUI ran:\n\n```sh\ngit push --set-upstream origin HEAD:refs\/heads\/feat\/reject\n```/u);
    assert.match(prompt, /Its output:\n\n```text\n[^]*example-org\/web\.git[^]*\n```/u);
    assert.doesNotMatch(prompt, /s3cret/u);
    assert.match(prompt, /Already done:\n- Committed [0-9a-f]{7} "Blocked"/u);
    assert.match(prompt, /then push the branch\./u);
    assert.doesNotMatch(prompt, /commit the files/u);
    const prPrompt = delegationPrompt({ action: "draft_pr", files: [], prTitle: "Add hero", prBody: "Body", error });
    assert.match(prPrompt, /Requested pull request title: Add hero/u);
    assert.match(prPrompt, /Requested pull request description:\n\nBody/u);
  });

  it("turns an unexpected failure into a step error that keeps completed work", async () => {
    git(repo, "switch", "-qc", "feat/crash");
    await writeFile(join(repo, "a.txt"), "crash\n");
    const run: CommandRunner = async (command, args, opts) => {
      if (command === "git" && args.includes("push")) throw new Error("spawn git EAGAIN");
      return fakeGh().run(command, args, opts);
    };
    const service = new SessionChangesService({ run });
    const error = await service.ship({ cwd: repo, action: "commit_push", files: ["a.txt"], message: "Survive", branchPrefix: "feature/" }).catch((caught: unknown) => caught);
    assert.ok(error instanceof ShipStepError);
    assert.equal(error.step, "push");
    assert.equal(error.message, "spawn git EAGAIN");
    assert.equal(error.result.commit?.subject, "Survive");
    const prompt = delegationPrompt({ action: "commit_push", files: ["a.txt"], error });
    assert.match(prompt, /> spawn git EAGAIN/u);
    assert.match(prompt, /then push the branch\./u);
    assert.doesNotMatch(prompt, /Command HUI ran/u);
  });

  it("hands a failed pull request over with the gh command, shortening long arguments", async () => {
    git(repo, "switch", "-qc", "feat/moved");
    await writeFile(join(repo, "a.txt"), "moved\n");
    const gh = fakeGh({ create: { code: 1, stdout: "", stderr: "GraphQL: Could not resolve to a Repository with the name 'example-org/web'. (repository)" } });
    const service = new SessionChangesService({ run: gh.run });
    const body = `## Summary\n${"x".repeat(300)}`;
    const error = await service.ship({ cwd: repo, action: "draft_pr", files: ["a.txt"], message: "Move it", prTitle: "Move it", prBody: body, branchPrefix: "feature/" }).catch((caught: unknown) => caught);
    assert.ok(error instanceof ShipStepError);
    assert.equal(error.step, "pull_request");
    assert.equal(error.result.pushed, true);
    assert.match(error.command ?? "", /^gh pr create --draft --base main --head feat\/moved --title 'Move it' --body '## Summary\\nx{109}…'$/u);
    assert.match(error.output ?? "", /example-org\/web/u);
  });

  it("renders commands and redacts credentials for the hand-off", () => {
    assert.equal(displayCommand("git", ["push", "https://me:tok@github.com/acme/web.git", "it's"]), "git push https://***@github.com/acme/web.git 'it'\\''s'");
    assert.equal(redactCredentials("fatal: https://x:y@example.com/r and ssh://git@github.com/a"), "fatal: https://***@example.com/r and ssh://***@github.com/a");
    assert.equal(commandOutput({ code: 1, stdout: "out\n", stderr: "\nerr one\n\nerr two\n" }), "err one\nerr two\nout");
  });

  it("restores new files to untracked when the commit fails", async () => {
    await writeFile(join(repo, ".git", "hooks", "pre-commit"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
    await writeFile(join(repo, "fresh.txt"), "f\n");
    const service = new SessionChangesService({ run: fakeGh().run });
    await assert.rejects(service.ship({ cwd: repo, action: "commit", files: ["fresh.txt"], message: "x", branchPrefix: "feature/" }), (error: unknown) => error instanceof ShipStepError && error.step === "commit");
    assert.equal(git(repo, "status", "--porcelain"), "?? fresh.txt");
  });

  it("validates input before touching the checkout", async () => {
    const service = new SessionChangesService({ run: fakeGh().run });
    await assert.rejects(service.ship({ cwd: repo, action: "commit", files: [], branchPrefix: "f/" }), /Select at least one file/u);
    await assert.rejects(service.ship({ cwd: repo, action: "commit", files: ["b.txt"], branchPrefix: "f/" }), /no uncommitted changes/u);
    await assert.rejects(service.ship({ cwd: repo, action: "commit_push", files: [], branchPrefix: "f/" }), /Nothing to commit or push/u);
    git(repo, "remote", "remove", "origin");
    await writeFile(join(repo, "a.txt"), "q\n");
    await assert.rejects(service.ship({ cwd: repo, action: "commit_push", files: ["a.txt"], branchPrefix: "f/" }), /no remote/u);
    assert.equal(await readFile(join(repo, "a.txt"), "utf8"), "q\n");
  });
});
