import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { SLACK_REVOKED_MESSAGE, SLACK_SCOPE_NAMES, slackManifestJson } from "../shared/slack.ts";
import { createSlackFake, type FakeSlackState } from "../e2e/slack-fixture.mjs";
import { normalizeSlackToken, SlackApiError, SlackClient, SlackConfigStore, SlackConnector, SlackInputError, slackOrigin } from "./slack.ts";

const TOKEN = "xoxp-1111-2222-3333-abcdefabcdef";
const OTHER = "xoxp-9999-8888-7777-fedcbafedcba";
const IDENTITY = { userId: "U0OPERATOR", user: "dani", teamId: "T0ACME", team: "Acme", url: "https://acme.slack.com/" };

function state(extra: Partial<FakeSlackState> = {}): FakeSlackState {
  return { tokens: { [TOKEN]: { ...IDENTITY } }, users: {}, messages: [], ...extra };
}

async function dir(t: TestContext): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "hui-check-slack-"));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
}

test("a pasted token is checked before Slack is asked, and no refusal quotes it", () => {
  assert.equal(normalizeSlackToken(`  ${TOKEN}\n`), TOKEN);
  assert.equal(normalizeSlackToken("xoxe.xoxp-1-abcdefghijkl"), "xoxe.xoxp-1-abcdefghijkl", "a rotating app's token");
  for (const [raw, message] of [
    ["", /Paste your Slack app's User OAuth Token/u],
    ["xoxb-1234-5678-abcdefabcdef", /bot or app token/u],
    ["xapp-1-A111-222-abcdef", /doesn't look like/u],
    ["hunter2-not-a-token", /doesn't look like a Slack User OAuth Token/u],
    [`xoxp-${"a".repeat(600)}`, /too long/u],
  ] as const) {
    assert.throws(() => normalizeSlackToken(raw), (error: unknown) => error instanceof SlackInputError && message.test(error.message) && !(raw && error.message.includes(raw)), raw.slice(0, 20));
  }
});

test("only Slack, or one exact loopback origin for tests, ever receives the token", () => {
  assert.equal(slackOrigin({}), "https://slack.com");
  assert.equal(slackOrigin({ HUI_SLACK_TEST_ORIGIN: "http://127.0.0.1:4555" }), "http://127.0.0.1:4555");
  assert.equal(slackOrigin({ HUI_SLACK_TEST_ORIGIN: "http://localhost:4555/" }), "http://localhost:4555");
  for (const origin of ["https://evil.example", "http://10.0.0.5:80", "http://127.0.0.1:4555/api", "http://user:pw@127.0.0.1:1", "not a url"]) {
    assert.equal(slackOrigin({ HUI_SLACK_TEST_ORIGIN: origin }), "https://slack.com", origin);
  }
});

test("the client posts a form, the token only in its Authorization header, redirects refused; auth.test says who and which workspace", async () => {
  const fake = createSlackFake(state({ tokens: { [TOKEN]: { ...IDENTITY, enterpriseId: "E0ORG", scopes: ["search:read", "users:read"] } } }));
  const seen: { url: string; init: RequestInit }[] = [];
  const client = new SlackClient(TOKEN, { origin: "http://127.0.0.1:1", fetch: async (url, init) => { seen.push({ url, init }); return fake.fetch(url, init); } });
  assert.deepEqual(await client.authTest(), { ...IDENTITY, enterpriseId: "E0ORG", scopes: ["search:read", "users:read"] });
  const [call] = seen;
  assert.equal(call?.url, "http://127.0.0.1:1/api/auth.test");
  assert.equal(call?.init.method, "POST");
  assert.equal(call?.init.redirect, "error");
  assert.equal(new Headers(call?.init.headers).get("authorization"), `Bearer ${TOKEN}`);
  assert.ok(!String(call?.init.body).includes(TOKEN), "never in the body");
  assert.ok(!call?.url.includes(TOKEN), "never in the URL");
  await assert.rejects(new SlackClient(OTHER, { origin: "http://127.0.0.1:1", fetch: fake.fetch }).authTest(), (error: unknown) => error instanceof SlackApiError && error.code === "invalid_auth" && error.message === SLACK_REVOKED_MESSAGE);
});

test("429 carries Retry-After; HTTP errors, unreadable answers and unreachable Slack are typed errors", async () => {
  const fake = createSlackFake(state({ rateLimited: { method: "search.messages", retryAfter: 42, times: 1 } }));
  const client = new SlackClient(TOKEN, { origin: "http://127.0.0.1:1", fetch: fake.fetch });
  await assert.rejects(client.searchMessages("<@U0OPERATOR>"), (error: unknown) => error instanceof SlackApiError && error.code === "ratelimited" && error.status === 429 && error.retryAfterMs === 42_000);
  assert.deepEqual((await client.searchMessages("<@U0OPERATOR>")).matches, [], "once Slack allows it again");
  const answer = (status: number, body: string) => new SlackClient(TOKEN, { origin: "http://127.0.0.1:1", fetch: async () => new Response(body, { status }) });
  await assert.rejects(answer(502, "bad gateway").authTest(), (error: unknown) => error instanceof SlackApiError && error.code === "http_502");
  await assert.rejects(answer(200, "<html>").authTest(), (error: unknown) => error instanceof SlackApiError && error.code === "invalid_response");
  await assert.rejects(new SlackClient(TOKEN, { origin: "http://127.0.0.1:1", fetch: async () => { throw new TypeError("fetch failed"); } }).authTest(), (error: unknown) => error instanceof SlackApiError && error.code === "unreachable");
});

test("the connection is stored owner-only, verified first, and its view never carries the token", async (t) => {
  const root = await dir(t);
  const file = join(root, "hui", "slack.json");
  const fake = createSlackFake(state({ tokens: { [TOKEN]: { ...IDENTITY, scopes: [...SLACK_SCOPE_NAMES] }, [OTHER]: { ...IDENTITY, revoked: true } } }));
  let now = Date.parse("2026-10-08T09:00:00Z");
  const connector = new SlackConnector({ store: new SlackConfigStore(file), fetch: fake.fetch, origin: "http://127.0.0.1:1", now: () => now });
  const changes: string[] = [];
  connector.onChange(() => changes.push("changed"));
  const watch = { active: false };
  assert.deepEqual(await connector.view(watch), { configured: false, status: "not_connected", message: "Not connected.", watch });
  await assert.rejects(connector.connect(OTHER), (error: unknown) => error instanceof SlackApiError && error.code === "token_revoked");
  await assert.rejects(stat(file), "a refused token is never stored");
  await connector.connect(TOKEN);
  assert.equal((await stat(file)).mode & 0o777, 0o600, "readable by the operator only");
  assert.equal(JSON.parse(await readFile(file, "utf8")).token, TOKEN);
  const view = await connector.view(watch);
  assert.deepEqual({ ...view, checkedAt: undefined }, { configured: true, status: "connected", message: "Connected as dani in Acme.", user: "dani", userId: "U0OPERATOR", team: "Acme", teamId: "T0ACME", url: "https://acme.slack.com/", scopes: [...SLACK_SCOPE_NAMES], checkedAt: undefined, watch });
  assert.ok(!JSON.stringify(view).includes(TOKEN), "the view never carries it");
  assert.deepEqual(changes, ["changed"]);
  // The poller hears Slack refuse it: the status says to connect again, without a check of its own.
  connector.refused(new SlackApiError("token_revoked"));
  assert.equal(connector.revoked, true);
  const revoked = await connector.view(watch);
  assert.deepEqual([revoked.status, revoked.message], ["revoked", SLACK_REVOKED_MESSAGE]);
  // A check asks Slack again when the last answer is stale: the token still works here, so it is connected again.
  now += 11 * 60_000;
  assert.equal((await connector.view(watch, { verify: true })).status, "connected");
  fake.state.tokens[TOKEN]!.revoked = true;
  now += 11 * 60_000;
  assert.equal((await connector.view(watch, { verify: true })).status, "revoked");
  await connector.disconnect();
  await assert.rejects(stat(file), "disconnect removes it from the machine");
  assert.equal((await connector.view(watch)).status, "not_connected");
  assert.deepEqual(changes, ["changed", "changed"]);
});

test("a token without every scope connects and says which are missing", async (t) => {
  const root = await dir(t);
  const fake = createSlackFake(state({ tokens: { [TOKEN]: { ...IDENTITY, scopes: ["search:read"] } } }));
  const connector = new SlackConnector({ store: new SlackConfigStore(join(root, "slack.json")), fetch: fake.fetch, origin: "http://127.0.0.1:1" });
  await connector.connect(TOKEN);
  const view = await connector.view({ active: false });
  assert.equal(view.status, "missing_scopes");
  assert.deepEqual(view.missingScopes, ["users:read", "channels:history", "groups:history", "im:history", "mpim:history"]);
  assert.match(view.message, /^Connected as dani in Acme, but the token lacks users:read, channels:history/u);
});

test("the manifest asks for read-only user scopes only: no bot, no events, no Socket Mode, no token rotation", () => {
  const manifest = JSON.parse(slackManifestJson()) as Record<string, any>;
  assert.deepEqual(manifest.oauth_config, { scopes: { user: ["search:read", "users:read", "channels:history", "groups:history", "im:history", "mpim:history"] } });
  assert.equal(manifest.features, undefined, "no bot user");
  assert.deepEqual(manifest.settings, { org_deploy_enabled: false, socket_mode_enabled: false, token_rotation_enabled: false });
  assert.ok(SLACK_SCOPE_NAMES.every((scope) => /:(?:read|history)$/u.test(scope)), "nothing that writes");
});
