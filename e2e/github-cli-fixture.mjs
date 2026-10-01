#!/usr/bin/env node
/* Fake GitHub CLI for tests and Browser E2E. Implements only what HUI calls:
 * `--version`, `auth status --hostname github.com --json hosts` and
 * `auth login --web`, `config get git_protocol`, a few canned `api` reads and
 * `pr list` (pull-requests.json) and `api graphql` searches and review-comment lookups
 * for the Pull Requests page (search-*.json), and `pr review … --approve`
 * (pr-review-args; review-fail holds an error to fail with).
 * State lives in HUI_FAKE_GH_DIR:
 *   account  — the signed-in login (absent: signed out)
 *   approve  — created by the test to approve a pending login
 *   deny     — created by the test to reject a pending login
 *   accounts — optional logins, one per line, the first active (overrides account)
 *   contributions.json — `{ login: { commits: [iso], pullRequests: [iso], createdAt? } | "error" }`
 *                  served by `api -X GET search/commits`, `api graphql` pull request
 *                  searches (both logged to search-log) and `api user`;
 *                  `rate-limit-once` fails the next commit search with a rate limit
 * HUI_FAKE_GH_CODE overrides the printed one-time code; HUI_FAKE_GH_PROTOCOL
 * is the configured git protocol. Each login writes its arguments to login-args. */
import { appendFileSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.env.HUI_FAKE_GH_DIR;
if (!dir) {
  process.stderr.write("HUI_FAKE_GH_DIR is not set\n");
  process.exit(2);
}
const file = (name) => join(dir, name);
const args = process.argv.slice(2);
const accounts = () => {
  if (existsSync(file("accounts"))) return readFileSync(file("accounts"), "utf8").split("\n").map((line) => line.trim()).filter(Boolean);
  return existsSync(file("account")) ? [readFileSync(file("account"), "utf8").trim()].filter(Boolean) : [];
};

if (args[0] === "--version") {
  process.stdout.write("gh version 9.9.9 (fixture)\nhttps://github.com/cli/cli/releases/tag/v9.9.9\n");
} else if (args[0] === "auth" && args[1] === "status") {
  const logins = accounts();
  const hosts = logins.length
    ? { "github.com": logins.map((login, index) => ({ state: "success", active: index === 0, host: "github.com", login, tokenSource: "keyring", scopes: "gist, read:org, repo", gitProtocol: "https" })) }
    : {};
  process.stdout.write(`${JSON.stringify({ hosts })}\n`);
} else if (args[0] === "auth" && args[1] === "token") {
  const login = args[args.indexOf("--user") + 1];
  if (!accounts().includes(login)) {
    process.stderr.write(`no oauth token found for github.com account ${login}\n`);
    process.exit(1);
  }
  process.stdout.write(`fake-token-${login}\n`);
} else if (args[0] === "api" && args[1] === "user") {
  // `gh api user --jq .created_at` for the account whose token the call carries.
  const login = process.env.GH_TOKEN?.replace(/^fake-token-/u, "") ?? accounts()[0];
  const data = existsSync(file("contributions.json")) ? JSON.parse(readFileSync(file("contributions.json"), "utf8")) : {};
  process.stdout.write(`${data[login]?.createdAt ?? "2020-06-01T00:00:00Z"}\n`);
} else if (args[0] === "api" && args[1] === "graphql" && args.some((arg) => /^(?:q|number)=/u.test(arg))) {
  // Pull Requests page searches: search-created.json / search-review-requested.json
  // hold the `nodes` of each search (absent: none). A single pull request
  // (review comments) is looked up by number among the created nodes.
  if (!accounts().length) {
    process.stderr.write("To get started with GitHub CLI, please run:  gh auth login\n");
    process.exit(4);
  }
  const number = args.find((arg) => arg.startsWith("number="));
  if (number) {
    const nodes = existsSync(file("search-created.json")) ? JSON.parse(readFileSync(file("search-created.json"), "utf8")) : [];
    const pullRequest = nodes.find((node) => `number=${node.number}` === number) ?? null;
    process.stdout.write(`${JSON.stringify({ data: { repository: { pullRequest } } })}\n`);
    process.exit(0);
  }
  const q = args.find((arg) => arg.startsWith("q=")) ?? "";
  const name = q.includes("author:@me") ? "search-created.json" : "search-review-requested.json";
  const nodes = existsSync(file(name)) ? JSON.parse(readFileSync(file(name), "utf8")) : [];
  process.stdout.write(`${JSON.stringify({ data: { search: { nodes } } })}\n`);
} else if (args[0] === "api" && args[1] === "graphql") {
  // HUI's aliased pull request searches; the cursor is the next result's index.
  const query = args[args.indexOf("-f") + 1].slice("query=".length);
  const data = existsSync(file("contributions.json")) ? JSON.parse(readFileSync(file("contributions.json"), "utf8")) : {};
  const result = {};
  for (const [, alias, after, login, from, to] of query.matchAll(/(\w+): search\(type: ISSUE, first: 100(?:, after: "(\d+)")?, query: "author:(\S+) is:pr created:(\S+)\.\.(\S+)"\)/gu)) {
    if (typeof data[login] === "string") {
      process.stderr.write(`gh: ${data[login]}\n`);
      process.exit(1);
    }
    const start = Number(after ?? 0);
    const dates = (data[login]?.pullRequests ?? []).filter((date) => date.slice(0, 10) >= from && date.slice(0, 10) <= to);
    appendFileSync(file("search-log"), `graphql ${login} ${from}..${to} page=${start / 100 + 1} token=${process.env.GH_TOKEN ?? ""}\n`);
    const nodes = dates.slice(start, start + 100).map((createdAt) => ({ createdAt }));
    result[alias] = { issueCount: dates.length, pageInfo: { hasNextPage: start + 100 < dates.length, endCursor: String(start + 100) }, nodes };
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
} else if (args[0] === "api" && args[3]?.startsWith("search/")) {
  // `gh api --jq` output for HUI's contribution searches: the first call prints
  // total_count and page one; `-f page=N` prints page N (up to result 1000).
  const field = (name) => args.find((arg, index) => args[index - 1] === "-f" && arg.startsWith(`${name}=`))?.slice(name.length + 1);
  const query = field("q") ?? "";
  const login = /author:(\S+)/u.exec(query)?.[1] ?? "";
  const [from, to] = (/:(\d{4}-\d\d-\d\d)\.\.(\d{4}-\d\d-\d\d)/u.exec(query) ?? []).slice(1);
  const data = existsSync(file("contributions.json")) ? JSON.parse(readFileSync(file("contributions.json"), "utf8")) : {};
  if (typeof data[login] === "string") {
    process.stderr.write(`gh: ${data[login]}\n`);
    process.exit(1);
  }
  if (existsSync(file("rate-limit-once"))) {
    rmSync(file("rate-limit-once"));
    process.stderr.write("gh: HTTP 403: API rate limit exceeded for user ID 1.\n");
    process.exit(1);
  }
  const all = data[login]?.[args[3] === "search/commits" ? "commits" : "pullRequests"] ?? [];
  const dates = all.filter((date) => date.slice(0, 10) >= from && date.slice(0, 10) <= to);
  const page = Number(field("page") ?? 1);
  appendFileSync(file("search-log"), `${args[3]} ${login} ${from}..${to} page=${page} token=${process.env.GH_TOKEN ?? ""}\n`);
  const items = dates.slice(0, 1000).slice((page - 1) * 100, page * 100);
  const shown = page > 1 ? items : [String(dates.length), ...items];
  process.stdout.write(shown.map((line) => `${line}\n`).join(""));
} else if (args[0] === "api") {
  // Canned REST payloads for chat embed and PR badge previews; unknown paths are 404.
  const login = existsSync(file("account")) ? readFileSync(file("account"), "utf8").trim() : "";
  if (!login) {
    process.stderr.write("To get started with GitHub CLI, please run:  gh auth login\n");
    process.exit(4);
  }
  const pull = (number, patch) => ({ number, title: `Fixture pull request ${number}`, state: "open", draft: false, merged: false, user: { login: "hui-e2e" }, additions: 120, deletions: 34, changed_files: 5, comments: 2, review_comments: 1, body: "Adds GitHub link previews to chat messages.\n\n## Details\nMore.", ...patch });
  const payloads = {
    "repos/acme/web": { full_name: "acme/web", description: "Acme storefront and design system", stargazers_count: 1284, forks_count: 97, language: "TypeScript", private: true, archived: false },
    "repos/acme/web/pulls/12": pull(12),
    "repos/acme/web/pulls/13": pull(13, { state: "closed", merged: true, title: "Ship the checkout redesign" }),
    "repos/acme/web/issues/13": { number: 13, pull_request: {} },
    "repos/acme/web/issues/7": { number: 7, title: "Checkout button overlaps footer on mobile", state: "closed", state_reason: "completed", user: { login: "lana" }, comments: 4, labels: [{ name: "bug" }, { name: "mobile" }], body: "Seen on iOS Safari." },
  };
  const payload = payloads[args[1]];
  if (!payload) {
    process.stderr.write("gh: Not Found (HTTP 404)\n");
    process.exit(1);
  }
  process.stdout.write(`${JSON.stringify(payload)}\n`);
} else if (args[0] === "pr" && args[1] === "list") {
  // Pull requests from pull-requests.json when present. Like `gh pr list
  // --head`, entries with a headRefName only match their branch.
  const head = args.includes("--head") ? args[args.indexOf("--head") + 1] : undefined;
  const all = existsSync(file("pull-requests.json")) ? JSON.parse(readFileSync(file("pull-requests.json"), "utf8")) : [];
  process.stdout.write(`${JSON.stringify(all.filter((entry) => !head || !entry.headRefName || entry.headRefName === head))}\n`);
} else if (args[0] === "pr" && args[1] === "review") {
  // Records the exact arguments. On success the pull request leaves the
  // Review requested search, as it does on GitHub once reviewed.
  writeFileSync(file("pr-review-args"), JSON.stringify(args));
  if (existsSync(file("review-fail"))) {
    process.stderr.write(readFileSync(file("review-fail"), "utf8"));
    process.exit(1);
  }
  const repo = args[args.indexOf("-R") + 1];
  const url = `https://github.com/${repo}/pull/${args[2]}`;
  const name = file("search-review-requested.json");
  if (existsSync(name)) writeFileSync(name, JSON.stringify(JSON.parse(readFileSync(name, "utf8")).filter((node) => node.url !== url)));
  process.stderr.write(`✓ Approved pull request ${repo}#${args[2]}\n`);
} else if (args[0] === "config" && args[1] === "get" && args[2] === "git_protocol") {
  process.stdout.write(`${process.env.HUI_FAKE_GH_PROTOCOL || "https"}\n`);
} else if (args[0] === "auth" && args[1] === "login") {
  writeFileSync(file("login-args"), args.join(" "));
  const code = process.env.HUI_FAKE_GH_CODE || "ABCD-1234";
  process.stderr.write(`! First copy your one-time code: ${code}\nOpen this URL to continue in your web browser: https://github.com/login/device\n`);
  const timer = setInterval(() => {
    if (existsSync(file("approve"))) {
      clearInterval(timer);
      rmSync(file("approve"));
      writeFileSync(file("account"), "hui-e2e\n");
      process.stderr.write("✓ Authentication complete.\n✓ Logged in as hui-e2e\n");
      process.exit(0);
    }
    if (existsSync(file("deny"))) {
      clearInterval(timer);
      rmSync(file("deny"));
      process.stderr.write("X failed to authenticate via web browser: the user denied the request\n");
      process.exit(1);
    }
  }, 50);
} else {
  process.stderr.write(`unsupported fake gh command: ${args.join(" ")}\n`);
  process.exit(2);
}
