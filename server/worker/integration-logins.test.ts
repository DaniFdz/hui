import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";

import { gatherIntegrationLogins, githubAccounts, githubHostsFile, pupFiles } from "./integration-logins.ts";

const PROD = [{ name: "prod", site: "app.datadoghq.com" }];

// One account has expired, so gh exits 1 while still printing the accounts it knows: the worker keeps both.
const FAKE_GH = `#!/bin/sh
case "$*" in
  *"auth status"*) printf '%s' '{"hosts":{"github.com":[
    {"state":"error","active":true,"host":"github.com","login":"me"},
    {"state":"success","active":false,"host":"github.com","login":"other"}]}}'; exit 1 ;;
  *"--user me"*) printf 'gho_me_token\\n' ;;
  *"--user other"*) printf 'gho_other_token\\n' ;;
  *) exit 1 ;;
esac
`;

async function fixture(t: { onTestFinished(fn: () => unknown): void }) {
  const root = await mkdtemp(join(tmpdir(), "hui-integrations-"));
  t.onTestFinished(() => rm(root, { recursive: true, force: true }));
  const gh = join(root, "gh");
  await writeFile(gh, FAKE_GH);
  await chmod(gh, 0o755);
  const pupDir = join(root, "pup");
  await mkdir(pupDir, { recursive: true });
  return { root, gh, pupDir };
}

test("a worker's hosts file holds every account gh has, active first", () => {
  const hosts = githubHostsFile([
    { login: "me", token: "gho_me_token" },
    { login: "other", token: "gho_other_token" },
  ], "other");
  assert.equal(hosts, [
    "github.com:",
    "    users:",
    "        me:",
    "            oauth_token: gho_me_token",
    "        other:",
    "            oauth_token: gho_other_token",
    "    user: other",
    "    oauth_token: gho_other_token",
    "",
  ].join("\n"));
  // An unknown active account falls back to the first one gh lists.
  assert.match(githubHostsFile([{ login: "me", token: "t" }], "gone"), /user: me$/mu);
  assert.equal(githubHostsFile([]), "");
});

test("a token in the gateway's environment does not stand in for its gh logins", async (t) => {
  const { gh } = await fixture(t);
  const accounts = await githubAccounts(gh, { ...process.env, GH_TOKEN: "shadow", GITHUB_TOKEN: "shadow" });
  assert.deepEqual(accounts.map((account) => account.login), ["me", "other"]);
});

test("the gateway's GitHub accounts and pup sessions become the worker's logins", async (t) => {
  const { root, gh, pupDir } = await fixture(t);
  const session = (access: string) => ({ access_token: access, refresh_token: "r", token_type: "Bearer", expires_in: 3600, issued_at: 1_760_000_000, scope: "dashboards_read", client_id: "c" });
  await writeFile(join(pupDir, "tokens_datadoghq_com.json"), JSON.stringify({ prod: session("prod-access"), staging: session("staging-access") }));
  await writeFile(join(pupDir, "client_datadoghq_com.json"), JSON.stringify({ client_id: "c" }));
  await writeFile(join(pupDir, "client_us3_datadoghq_com.json"), JSON.stringify({ client_id: "other-site" }));
  await writeFile(join(pupDir, "sessions.json"), JSON.stringify([
    { site: "datadoghq.com", org: "prod", org_uuid: "8dee" },
    { site: "datadoghq.com", org: "staging", org_uuid: "9eee" },
    { site: "us3.datadoghq.com", org: "", org_uuid: "aeee" },
  ]));
  await writeFile(join(pupDir, "config.yml"), "aliases: {}\n");
  const jiraFile = join(root, "jira.json");
  await writeFile(jiraFile, JSON.stringify({ version: 1, site: "https://acme.atlassian.net", email: "me@example.test", token: "jira-token", defaultProject: "" }));

  const logins = await gatherIntegrationLogins({ gh, env: { ...process.env }, pupDir, orgs: PROD, jiraFile });

  const byPath = new Map(logins.files.map((file) => [file.path, file]));
  assert.deepEqual([...byPath.keys()].sort(), [
    "hui/integrations/gh/hosts.yml",
    "hui/integrations/pup/client_datadoghq_com.json",
    "hui/integrations/pup/sessions.json",
    "hui/integrations/pup/tokens_datadoghq_com.json",
  ]);
  const hosts = byPath.get("hui/integrations/gh/hosts.yml")!;
  assert.equal(hosts.mode, 0o600);
  assert.equal(hosts.content!.toString(), ["github.com:", "    users:", "        me:", "            oauth_token: gho_me_token", "        other:", "            oauth_token: gho_other_token", "    user: me", "    oauth_token: gho_me_token", ""].join("\n"));
  assert.deepEqual(JSON.parse(byPath.get("hui/integrations/pup/tokens_datadoghq_com.json")!.content!.toString()), { prod: session("prod-access") });
  assert.deepEqual(JSON.parse(byPath.get("hui/integrations/pup/sessions.json")!.content!.toString()), [{ site: "datadoghq.com", org: "prod", org_uuid: "8dee" }]);
  assert.deepEqual(logins.env, { ATLASSIAN_API_TOKEN: "jira-token", ATLASSIAN_ACCOUNT: "me@example.test", ATLASSIAN_SITE: "acme.atlassian.net" });
  assert.deepEqual(logins.skipped, [], "a session HUI does not list is not shared");
});

test("an integration the gateway is not signed in to is skipped, never guessed", async (t) => {
  const { root, gh, pupDir } = await fixture(t);
  const logins = await gatherIntegrationLogins({ gh: join(root, "no-such-gh"), env: { ...process.env }, pupDir, orgs: PROD, jiraFile: join(root, "no-jira.json") });
  assert.deepEqual(logins.files, []);
  assert.deepEqual(logins.env, {});
  assert.deepEqual(logins.skipped.map((line) => line.split(":")[0]), ["GitHub", "Datadog", "Jira"]);
  // No org in Settings is a different reason from an org pup has no token for.
  const noOrgs = await gatherIntegrationLogins({ gh, env: { ...process.env }, pupDir, orgs: [], jiraFile: join(root, "no-jira.json") });
  assert.match(noOrgs.skipped[0]!, /^Datadog: no orgs in Settings/u);
});

test("pup's own config, an unlisted site and an unreadable file stay on the gateway", async (t) => {
  const { pupDir } = await fixture(t);
  await writeFile(join(pupDir, "tokens_datadoghq_com.json"), JSON.stringify({ prod: { access_token: "a" }, staging: { access_token: "b" } }));
  await writeFile(join(pupDir, "tokens_us3_datadoghq_com.json"), JSON.stringify({ __default__: { access_token: "c" } }));
  await writeFile(join(pupDir, "sessions.json"), JSON.stringify([{ site: "datadoghq.com", org: "prod", org_uuid: "8dee" }]));
  await writeFile(join(pupDir, "tokens_datadoghq_eu.json"), "x".repeat(64 * 1024 + 1));
  await writeFile(join(pupDir, "notes.json"), "{}");
  await writeFile(join(pupDir, "config.yml"), "aliases: {}\n");
  const shared = await pupFiles(pupDir, PROD);
  assert.deepEqual(shared.map((file) => file.path), ["hui/integrations/pup/tokens_datadoghq_com.json", "hui/integrations/pup/sessions.json"]);
  assert.deepEqual(JSON.parse(shared[0]!.content!.toString()), { prod: { access_token: "a" } }, "a token pup does not list is not shared");
  assert.deepEqual(await pupFiles(pupDir, [{ name: "prod", site: "app.datadoghq.eu" }]), [], "an unreadable file is never shared");
});

test("an account gh cannot print a token for is left out", async (t) => {
  const { root } = await fixture(t);
  const partial = join(root, "gh-partial");
  await writeFile(partial, FAKE_GH.replace("*\"--user other\"*) printf 'gho_other_token\\n' ;;", "*\"--user other\"*) exit 1 ;;"));
  await chmod(partial, 0o755);
  assert.deepEqual((await githubAccounts(partial, { ...process.env })).map((account) => account.login), ["me"]);
});
