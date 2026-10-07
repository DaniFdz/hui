#!/usr/bin/env node
/* A fake GitHub REST API behind a fake `gh`, for triggers' tests and live checks (HUI-18). It answers what the
 * GitHub pollers ask (`gh api --include [-H "If-None-Match: <etag>"] <path>`) from a JSON state, with ETags: a
 * request whose If-None-Match matches the answer's ETag gets 304, as GitHub's conditional requests do, and gh exits
 * 1 with `gh: HTTP 304` as the real one does. Every request is logged with its status.
 *
 * As a module: `createGitHubFake(state)` answers in-process (`respond(path, etag)`), for unit tests.
 * As `gh` (HUI_GITHUB_CLI=e2e/github-triggers-fixture.mjs): the state is `$HUI_FAKE_GH_DIR/github.json` (edit it to
 * make pull requests happen), the log `$HUI_FAKE_GH_DIR/requests.jsonl`; `--version` and `auth status` answer too.
 *
 * State: { login, pollInterval?, rateLimited?: { retryAfter }, repos: { "owner/name": { pulls: [GitHub pull objects],
 *   reviews: { "<number>": [reviews] }, issueComments: [...], reviewComments: [...], checkRuns: { "<sha>": [runs] },
 *   statuses: { "<sha>": [statuses] } } } }
 */
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const REASONS = { 200: "OK", 304: "Not Modified", 403: "Forbidden", 404: "Not Found", 429: "Too Many Requests" };

const byDate = (key) => (a, b) => Date.parse(b[key] ?? 0) - Date.parse(a[key] ?? 0);

/** The answer to one GET, before ETags: `{ status, body }`. */
function answer(state, path) {
  const url = new URL(path, "https://api.github.com/");
  const parts = url.pathname.split("/").filter(Boolean);
  const perPage = Number(url.searchParams.get("per_page") ?? 30);
  if (parts.length === 1 && parts[0] === "user") return { status: 200, body: { login: state.login ?? "operator" } };
  if (parts[0] !== "repos" || parts.length < 4) return { status: 404, body: { message: "Not Found" } };
  const repo = state.repos?.[`${parts[1]}/${parts[2]}`] ?? state.repos?.[`${parts[1]}/${parts[2]}`.toLowerCase()];
  if (!repo) return { status: 404, body: { message: "Not Found" } };
  const rest = parts.slice(3);
  if (rest[0] === "pulls" && rest.length === 1) return { status: 200, body: [...(repo.pulls ?? [])].sort(byDate("updated_at")).slice(0, perPage) };
  if (rest[0] === "pulls" && rest[1] === "comments") return { status: 200, body: [...(repo.reviewComments ?? [])].sort(byDate("created_at")).slice(0, perPage) };
  if (rest[0] === "pulls" && /^\d+$/u.test(rest[1] ?? "")) {
    if (rest[2] === "reviews") return { status: 200, body: repo.reviews?.[rest[1]] ?? [] };
    const pull = (repo.pulls ?? []).find((each) => String(each.number) === rest[1]);
    return pull ? { status: 200, body: pull } : { status: 404, body: { message: "Not Found" } };
  }
  if (rest[0] === "issues" && rest[1] === "comments") return { status: 200, body: [...(repo.issueComments ?? [])].sort(byDate("created_at")).slice(0, perPage) };
  if (rest[0] === "commits" && rest[2] === "check-runs") {
    const runs = repo.checkRuns?.[rest[1]] ?? [];
    return { status: 200, body: { total_count: runs.length, check_runs: runs } };
  }
  if (rest[0] === "commits" && rest[2] === "status") {
    const statuses = repo.statuses?.[rest[1]] ?? [];
    const state = statuses.some((each) => each.state === "failure" || each.state === "error") ? "failure" : statuses.some((each) => each.state === "pending") ? "pending" : "success";
    return { status: 200, body: { state, total_count: statuses.length, statuses } };
  }
  return { status: 404, body: { message: "Not Found" } };
}

/** In-process fake: `respond(path, etag)` answers as gh's parsed output would, and `log` keeps every request. */
export function createGitHubFake(initial) {
  const fake = {
    state: initial,
    log: [],
    respond(path, etag) {
      const headers = { date: new Date().toUTCString(), "x-ratelimit-limit": "5000", "x-ratelimit-remaining": "4990", "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 3600), "x-ratelimit-resource": "core" };
      if (fake.state.pollInterval) headers["x-poll-interval"] = String(fake.state.pollInterval);
      if (fake.state.rateLimited) {
        fake.log.push({ path, etag: etag ?? null, status: 403 });
        return { status: 403, headers: { ...headers, "retry-after": String(fake.state.rateLimited.retryAfter ?? 60), "x-ratelimit-remaining": "0" }, body: { message: "API rate limit exceeded" } };
      }
      const { status, body } = answer(fake.state, path);
      if (status !== 200) {
        fake.log.push({ path, etag: etag ?? null, status });
        return { status, headers, body };
      }
      const tag = `W/"${createHash("sha256").update(JSON.stringify(body)).digest("hex").slice(0, 40)}"`;
      const strip = (value) => String(value ?? "").replace(/^W\//u, "");
      if (etag && strip(etag) === strip(tag)) {
        fake.log.push({ path, etag, status: 304 });
        return { status: 304, headers: { ...headers, etag: tag.replace(/^W\//u, "") }, body: undefined };
      }
      fake.log.push({ path, etag: etag ?? null, status: 200 });
      return { status: 200, headers: { ...headers, etag: tag }, body };
    },
  };
  return fake;
}

/* ── as gh ──────────────────────────────────────────────────────────── */

function main(args) {
  const dir = process.env.HUI_FAKE_GH_DIR;
  if (!dir) {
    process.stderr.write("HUI_FAKE_GH_DIR is not set\n");
    process.exit(2);
  }
  const stateFile = join(dir, "github.json");
  const state = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, "utf8")) : { repos: {} };
  if (args[0] === "--version") {
    process.stdout.write("gh version 9.9.9 (triggers fixture)\n");
    return;
  }
  if (args[0] === "auth" && args[1] === "status") {
    const login = state.login ?? "operator";
    process.stdout.write(`${JSON.stringify({ hosts: { "github.com": [{ state: "success", active: true, host: "github.com", login, tokenSource: "keyring", scopes: "repo", gitProtocol: "https" }] } })}\n`);
    return;
  }
  if (args[0] !== "api") {
    process.stderr.write(`fake gh: unsupported command ${args.join(" ")}\n`);
    process.exit(1);
  }
  let etag;
  let path;
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "-H" || arg === "--header") {
      const header = args[++index] ?? "";
      if (/^if-none-match:/iu.test(header)) etag = header.slice(header.indexOf(":") + 1).trim();
    } else if (!arg.startsWith("-")) path = arg;
  }
  const fake = createGitHubFake(state);
  const result = fake.respond(path ?? "", etag);
  appendFileSync(join(dir, "requests.jsonl"), `${JSON.stringify({ ...fake.log[0], at: new Date().toISOString() })}\n`);
  const head = [`HTTP/1.1 ${result.status} ${REASONS[result.status] ?? ""}`, ...Object.entries(result.headers).map(([name, value]) => `${name.replace(/(^|-)([a-z])/gu, (_, dash, letter) => dash + letter.toUpperCase())}: ${value}\r`)].join("\n");
  process.stdout.write(`${head}\n\r\n${result.body === undefined ? "" : JSON.stringify(result.body)}`);
  if (result.status >= 300) {
    process.stderr.write(`gh: HTTP ${result.status}\n`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2));
