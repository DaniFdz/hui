#!/usr/bin/env node
/* A fake Slack Web API for Slack triggers' tests and live checks (HUI-18). It answers the read methods HUI calls
 * (auth.test, search.messages, users.info, conversations.replies) from a JSON state, as POSTs with a form body and the
 * token in the Authorization header, the way Slack's Web API takes them: `ok: false` errors, a 429 with Retry-After,
 * scopes in `x-oauth-scopes`. Search understands what HUI asks: `<@U…>` (messages that mention the member), `is:dm`
 * (direct and group direct messages), `after:YYYY-MM-DD` (exclusive), newest first, `count` and `page`. Every request
 * is logged with its method, its arguments and its status, never its token.
 *
 * As a module: `createSlackFake(state)` answers in-process (`fetch`), for unit tests; `startSlackServer(fake)` serves it
 * on 127.0.0.1.
 * As a program (HUI_SLACK_TEST_ORIGIN=<its URL> on the gateway): the state is `$HUI_FAKE_SLACK_DIR/slack.json`, read on
 * every request (edit it to make people ping you), the log `$HUI_FAKE_SLACK_DIR/requests.jsonl`; it prints its URL.
 *
 * State: { tokens: { "<token>": { userId, user, teamId, team, url, enterpriseId?, scopes?: [..], revoked?: true } },
 *   users: { "<id>": users.info's user }, messages: [search matches: { channel: { id, name, is_im?, is_mpim?,
 *   is_private?, is_ext_shared? }, ts, user?, username?, text, thread_ts?, bot_id?, subtype?, edited?, attachments?,
 *   team?, permalink? }], replies?: { "<channel>:<thread_ts>": [messages after the parent] },
 *   rateLimited?: { method?, retryAfter, times? } }
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const SCOPE_OF = { "search.messages": ["search:read"], "users.info": ["users:read"] };
const HISTORY = { im: "im:history", mpim: "mpim:history", group: "groups:history", channel: "channels:history" };

const kindOf = (channel = {}) => channel.is_im || String(channel.id ?? "").startsWith("D") ? "im" : channel.is_mpim ? "mpim" : channel.is_private ? "group" : "channel";
const permalinkOf = (identity, message) => message.permalink
  ?? `${identity.url ?? "https://acme.slack.com/"}archives/${message.channel?.id}/p${String(message.ts).replace(".", "")}${message.thread_ts && message.thread_ts !== message.ts ? `?thread_ts=${message.thread_ts}&cid=${message.channel?.id}` : ""}`;
const dayOf = (ts) => new Date(Number(ts) * 1000).toISOString().slice(0, 10);

/** search.messages as HUI uses it. */
function search(state, identity, params) {
  const query = String(params.query ?? "");
  const mention = /<@([A-Z0-9]+)>/u.exec(query)?.[1];
  const dm = /(?:^|\s)is:dm(?:\s|$)/u.test(query);
  const after = /after:(\d{4}-\d{2}-\d{2})/u.exec(query)?.[1];
  const count = Math.min(100, Math.max(1, Number(params.count ?? 20)));
  const page = Math.min(100, Math.max(1, Number(params.page ?? 1)));
  const all = (state.messages ?? []).filter((message) => {
    if (mention && !String(message.text ?? "").includes(`<@${mention}>`) && !String(message.text ?? "").includes(`<@${mention}|`)) return false;
    if (dm && !["im", "mpim"].includes(kindOf(message.channel))) return false;
    if (after && dayOf(message.ts) <= after) return false;
    return true;
  }).sort((a, b) => Number(b.ts) - Number(a.ts));
  const pages = Math.max(1, Math.ceil(all.length / count));
  const matches = all.slice((page - 1) * count, page * count).map((message) => ({
    iid: `${message.channel?.id}-${message.ts}`, type: kindOf(message.channel) === "im" ? "im" : kindOf(message.channel) === "group" ? "group" : "message",
    team: message.team ?? identity.teamId, ...message, permalink: permalinkOf(identity, message),
    channel: { is_ext_shared: false, is_mpim: false, is_org_shared: false, is_pending_ext_shared: false, is_private: false, is_shared: false, pending_shared: [], ...message.channel },
  }));
  return { ok: true, query, messages: { matches, paging: { count, page, pages, total: all.length }, total: all.length } };
}

/** In-process fake: `fetch(url, init)` answers as Slack would, `log` keeps every request (never a token). */
export function createSlackFake(initial) {
  const fake = {
    state: initial,
    log: [],
    async fetch(url, init = {}) {
      return fake.respond(String(url), init);
    },
    respond(url, init = {}) {
      const method = new URL(url).pathname.replace(/^\/api\//u, "");
      const headers = new Headers(init.headers ?? {});
      const token = (headers.get("authorization") ?? "").replace(/^Bearer /u, "");
      const params = Object.fromEntries(new URLSearchParams(typeof init.body === "string" ? init.body : ""));
      delete params.token;
      const reply = (status, body, extra = {}) => {
        fake.log.push({ method, params, status, error: body?.ok === false ? body.error : undefined, at: new Date().toISOString() });
        return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", ...extra } });
      };
      const limited = fake.state.rateLimited;
      if (limited && (!limited.method || limited.method === method) && (limited.times === undefined || limited.times > 0)) {
        if (limited.times !== undefined) limited.times -= 1;
        return reply(429, { ok: false, error: "ratelimited" }, { "retry-after": String(limited.retryAfter ?? 30) });
      }
      const identity = fake.state.tokens?.[token];
      if (!token) return reply(200, { ok: false, error: "not_authed" });
      if (!identity) return reply(200, { ok: false, error: "invalid_auth" });
      if (identity.revoked) return reply(200, { ok: false, error: "token_revoked" });
      const scopes = identity.scopes ?? ["search:read", "users:read", "channels:history", "groups:history", "im:history", "mpim:history"];
      const scopeHeader = { "x-oauth-scopes": scopes.join(",") };
      const needs = SCOPE_OF[method];
      if (needs && !needs.every((scope) => scopes.includes(scope))) return reply(200, { ok: false, error: "missing_scope", needed: needs.join(","), provided: scopes.join(",") }, scopeHeader);
      if (method === "auth.test") {
        return reply(200, { ok: true, url: identity.url, team: identity.team, user: identity.user, team_id: identity.teamId, user_id: identity.userId, ...(identity.enterpriseId ? { enterprise_id: identity.enterpriseId } : {}) }, scopeHeader);
      }
      if (method === "search.messages") return reply(200, search(fake.state, identity, params), scopeHeader);
      if (method === "users.info") {
        const user = fake.state.users?.[params.user];
        return user ? reply(200, { ok: true, user }, scopeHeader) : reply(200, { ok: false, error: "user_not_found" }, scopeHeader);
      }
      if (method === "conversations.replies") {
        const parent = (fake.state.messages ?? []).concat(fake.state.parents ?? []).find((message) => message.channel?.id === params.channel && message.ts === params.ts);
        if (!parent) return reply(200, { ok: false, error: "thread_not_found" }, scopeHeader);
        const needed = HISTORY[kindOf(parent.channel)];
        if (!scopes.includes(needed)) return reply(200, { ok: false, error: "missing_scope", needed }, scopeHeader);
        const replies = fake.state.replies?.[`${params.channel}:${params.ts}`] ?? [];
        const { channel: _channel, ...message } = parent;
        return reply(200, { ok: true, messages: [{ type: "message", thread_ts: parent.ts, ...message }, ...replies].slice(0, Number(params.limit ?? 1000)), has_more: false }, scopeHeader);
      }
      return reply(200, { ok: false, error: "unknown_method" });
    },
  };
  return fake;
}

/** Serves a fake on 127.0.0.1 (`port 0`: any free one); resolves with its origin and a close. `state`, when given, is
 * read again for each request (a file a test or a person edits). */
export function startSlackServer(fake, options = {}) {
  const server = createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", async () => {
      if (options.state) fake.state = options.state();
      const answer = fake.respond(`http://127.0.0.1${request.url}`, { method: request.method, headers: request.headers, body: Buffer.concat(chunks).toString("utf8") });
      options.onLog?.(fake.log.at(-1));
      response.writeHead(answer.status, Object.fromEntries(answer.headers));
      response.end(await answer.text());
    });
  });
  return new Promise((resolve) => {
    server.listen(options.port ?? 0, "127.0.0.1", () => {
      const address = server.address();
      resolve({ origin: `http://127.0.0.1:${address.port}`, close: () => new Promise((done) => { server.closeAllConnections?.(); server.close(() => done()); }) });
    });
  });
}

/* ── as a program ───────────────────────────────────────────────────── */

async function main() {
  const dir = process.env.HUI_FAKE_SLACK_DIR;
  if (!dir) {
    process.stderr.write("HUI_FAKE_SLACK_DIR is not set\n");
    process.exit(2);
  }
  const file = join(dir, "slack.json");
  const read = () => (existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : { tokens: {}, messages: [] });
  const fake = createSlackFake(read());
  const { origin } = await startSlackServer(fake, {
    port: Number(process.env.HUI_FAKE_SLACK_PORT ?? 0),
    state: read,
    onLog: (entry) => appendFileSync(join(dir, "requests.jsonl"), `${JSON.stringify(entry)}\n`),
  });
  process.stdout.write(`fake Slack listening on ${origin}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
