#!/usr/bin/env node
/* Fake GitHub CLI for tests and Browser E2E. Implements only what HUI calls:
 * `--version`, `auth status --hostname github.com --json hosts` and
 * `auth login --web`, `config get git_protocol`, a few canned `api` reads and
 * `pr list` (pull-requests.json).
 * State lives in HUI_FAKE_GH_DIR:
 *   account  — the signed-in login (absent: signed out)
 *   approve  — created by the test to approve a pending login
 *   deny     — created by the test to reject a pending login
 * HUI_FAKE_GH_CODE overrides the printed one-time code; HUI_FAKE_GH_PROTOCOL
 * is the configured git protocol. Each login writes its arguments to login-args. */
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.env.HUI_FAKE_GH_DIR;
if (!dir) {
  process.stderr.write("HUI_FAKE_GH_DIR is not set\n");
  process.exit(2);
}
const file = (name) => join(dir, name);
const args = process.argv.slice(2);

if (args[0] === "--version") {
  process.stdout.write("gh version 9.9.9 (fixture)\nhttps://github.com/cli/cli/releases/tag/v9.9.9\n");
} else if (args[0] === "auth" && args[1] === "status") {
  const login = existsSync(file("account")) ? readFileSync(file("account"), "utf8").trim() : "";
  const hosts = login
    ? { "github.com": [{ state: "success", active: true, host: "github.com", login, tokenSource: "keyring", scopes: "gist, read:org, repo", gitProtocol: "https" }] }
    : {};
  process.stdout.write(`${JSON.stringify({ hosts })}\n`);
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
