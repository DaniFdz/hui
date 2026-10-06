import assert from "node:assert/strict";
import { test } from "node:test";

import type { BotRecord, BotReply } from "../shared/bots.ts";
import { CALL_LIMITS } from "../shared/calls.ts";
import { DEFAULT_SETTINGS, type Settings } from "../src/lib/settings.ts";
import { BotConflictError, BotNotFoundError } from "./bots.ts";
import { checkLines, createCallRoutes, type CallRouteRequest } from "./call-routes.ts";
import { CallBroker, type CallAccounts } from "./calls.ts";

const TOKEN = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJyb3V0ZXMifQ.c2lnbmF0dXJl";
const ACCOUNT_ID = "acct-routes-1";
const OFFER = "v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n";
const ANSWER = "v=0\r\no=- 9 9 IN IP4 0.0.0.0\r\ns=-\r\nm=audio 3478 UDP/TLS/RTP/SAVPF 111\r\n";

function fixture(options: { engine?: Settings["calls"]["engine"]; voice?: Settings["calls"]["voice"]; upstream?: number; bot?: Partial<BotRecord> } = {}) {
  const bot: BotRecord = { id: "b1", handle: "juno", name: "Juno", cwd: "/tmp", sessionId: "s1", createdAt: "x", updatedAt: "x", instructions: "Be Juno.", ...options.bot };
  const sessions: unknown[] = [];
  const accounts: CallAccounts = {
    list: async () => [{ id: "default", name: "Main" }],
    signedIn: () => true,
    email: () => "dani@example.com",
    credential: async () => ({ access: TOKEN, accountId: ACCOUNT_ID }),
  };
  const fetcher = (async (_url: string, init: RequestInit) => {
    sessions.push(JSON.parse(String(init.body)).session);
    const status = options.upstream ?? 201;
    return new Response(status === 201 ? ANSWER : JSON.stringify({ error: `no for ${ACCOUNT_ID}` }), { status, headers: { location: "/v1/realtime/calls/rtc_routes" } });
  }) as unknown as typeof fetch;
  const broker = new CallBroker({ accounts, fetch: fetcher });
  const written: Array<[string, string, unknown]> = [];
  const tasks: Array<[string, string]> = [];
  let reply: BotReply = { status: "answered", reply: "Pancho." };
  const bots = {
    resolve: async (target: string) => {
      if (target !== bot.id && target !== bot.handle) throw new BotNotFoundError(`No bot named ${target}.`);
      return bot;
    },
    callContext: async (target: string) => {
      if (target !== bot.id && target !== bot.handle) throw new BotNotFoundError(`No bot named ${target}.`);
      if (bot.archived) throw new BotConflictError("archived");
      return { bot, view: "<chat>\n0+1|user: My dog is Pancho.\n</chat>" };
    },
    callLines: async (id: string, call: string, lines: unknown) => { written.push([id, call, lines]); },
  };
  const delegate = async (target: { id: string; name: string }, request: string) => { tasks.push([target.id, request]); return reply; };
  const settings: Settings = { ...DEFAULT_SETTINGS, profileName: "Dani", calls: { engine: options.engine ?? "gpt-live", voice: options.voice ?? "vale" } };
  const routes = createCallRoutes({ broker, bots: bots as never, delegate, settings: async () => settings, timeZone: () => "Europe/Madrid" });
  const call = (method: string, path: string, body?: unknown, raw?: string) => routes.handle({
    method, path,
    body: async (maxBytes: number) => {
      const text = raw ?? (body === undefined ? "" : JSON.stringify(body));
      if (Buffer.byteLength(text, "utf8") > maxBytes) throw new Error("request body too large");
      return JSON.parse(text || "null");
    },
  } satisfies CallRouteRequest);
  return { call, broker, sessions, written, tasks, setReply: (next: BotReply) => { reply = next; } };
}

test("GET /__hui/calls says whether ChatGPT is signed in and which account calls use, never a token", async () => {
  const f = fixture();
  const result = await f.call("GET", "/__hui/calls");
  assert.equal(result?.status, 200);
  assert.deepEqual(result?.body, {
    model: "gpt-live-1-codex", voices: ["cove", "arbor", "breeze", "ember", "juniper", "maple", "sol", "spruce", "vale"],
    chatgpt: { signedIn: true, account: { name: "Main", email: "dani@example.com" } }, active: 0, limit: CALL_LIMITS.concurrent,
  });
  assert.doesNotMatch(JSON.stringify(result?.body), /eyJ|acct-/u);
  assert.equal((await f.call("POST", "/__hui/calls"))?.status, 405);
  assert.equal(await f.call("GET", "/__hui/bots/juno"), undefined, "other bot routes are not the call routes'");
});

test("starting a call builds the bot's session, returns only the answer and refuses what it must", async () => {
  const f = fixture({ bot: { voice: { language: "es" } } });
  const started = await f.call("POST", "/__hui/bots/juno/calls", { sdp: OFFER });
  assert.equal(started?.status, 201);
  const body = started?.body as Record<string, unknown>;
  assert.match(String(body["callId"]), /^[0-9a-f-]{36}$/u);
  assert.equal(body["answer"], ANSWER);
  assert.equal(body["voice"], "vale", "Settings' voice for a bot without one");
  assert.deepEqual(body["account"], { name: "Main" });
  assert.equal(body["model"], "gpt-live-1-codex");
  assert(Number(body["instructionsBytes"]) > 1_000 && Number(body["memoryBytes"]) > 0);
  assert.doesNotMatch(JSON.stringify(body), /eyJ|acct-|rtc_routes/u, "no token, account id or provider call id reaches the browser");
  const session = f.sessions[0] as { model: string; instructions: string; audio: { output: { voice: string } } };
  assert.equal(session.model, "gpt-live-1-codex");
  assert.equal(session.audio.output.voice, "vale");
  assert.match(session.instructions, /You are Juno \(@juno\)\./u);
  assert.match(session.instructions, /Speak Spanish\./u);
  assert.match(session.instructions, /<instructions>\nBe Juno\.\n<\/instructions>/u);
  assert.match(session.instructions, /user: My dog is Pancho\./u);

  const own = fixture({ bot: { voice: { live: "ember" } } });
  assert.equal(((await own.call("POST", "/__hui/bots/b1/calls", { sdp: OFFER }))?.body as Record<string, unknown>)["voice"], "ember");

  const studio = fixture({ engine: "voicestudio" });
  const refused = await studio.call("POST", "/__hui/bots/juno/calls", { sdp: OFFER });
  assert.equal(refused?.status, 409);
  assert.match(String((refused?.body as { error: string }).error), /Choose GPT-Live in Settings → Models → Calls/u);
  for (const [body, raw, status] of [
    [{ sdp: "hello" }, undefined, 400], [{ sdp: OFFER, extra: 1 }, undefined, 400], [undefined, "{not json", 400],
    [undefined, JSON.stringify({ sdp: `${OFFER}${"a".repeat(CALL_LIMITS.sdp)}` }), 400],
  ] as const) assert.equal((await f.call("POST", "/__hui/bots/juno/calls", body, raw))?.status, status, raw?.slice(0, 20) ?? JSON.stringify(body));
  assert.equal((await f.call("POST", "/__hui/bots/nobody/calls", { sdp: OFFER }))?.status, 404);
  assert.equal((await f.call("GET", "/__hui/bots/juno/calls"))?.status, 405);
});

test("ChatGPT's refusals reach the browser as clear messages without the upstream body", async () => {
  for (const [status, pattern] of [[401, /Sign in to ChatGPT again/u], [403, /not available on this ChatGPT account or plan/u], [429, /limit for voice calls/u]] as const) {
    const result = await fixture({ upstream: status }).call("POST", "/__hui/bots/juno/calls", { sdp: OFFER });
    assert.equal(result?.status, 502);
    const body = result?.body as { error: string; upstreamStatus: number };
    assert.match(body.error, pattern);
    assert.equal(body.upstreamStatus, status);
    assert.doesNotMatch(JSON.stringify(body), /acct-|eyJ|no for/u);
  }
});

test("a call holds at most two slots; its lines, tasks, heartbeats and hang-up need the call", async () => {
  const f = fixture();
  const id = async () => ((await f.call("POST", "/__hui/bots/juno/calls", { sdp: OFFER }))?.body as { callId: string }).callId;
  const one = await id();
  const two = await id();
  const third = await f.call("POST", "/__hui/bots/juno/calls", { sdp: OFFER });
  assert.equal(third?.status, 429);
  assert.match(String((third?.body as { error: string }).error), /already running/u);

  const lines = [{ role: "user", text: "Hi Juno", at: Date.now() }, { role: "assistant", text: "Hey Dani!" }];
  const written = await f.call("POST", `/__hui/bots/juno/calls/${one}/lines`, { lines });
  assert.deepEqual(written, { status: 200, body: { written: 2 } });
  assert.equal(f.written[0]![0], "b1");
  assert.equal(f.written[0]![1], one);
  assert.deepEqual((f.written[0]![2] as { role: string; text: string }[]).map((line) => [line.role, line.text]), [["user", "Hi Juno"], ["assistant", "Hey Dani!"]]);

  assert.deepEqual(await f.call("POST", `/__hui/bots/juno/calls/${one}/delegations`, { id: "item_EVzd", request: "What's my dog called" }), { status: 200, body: { status: "answered", speak: "Pancho." } });
  assert.deepEqual(f.tasks, [["b1", "What's my dog called"]]);
  f.setReply({ status: "failed", error: "provider exploded" });
  assert.match(String(((await f.call("POST", `/__hui/bots/juno/calls/${one}/delegations`, { id: "item_2", request: "Again" }))?.body as { speak: string }).speak), /did not complete: provider exploded/u);
  for (const body of [{ id: "", request: "x" }, { id: "has space", request: "x" }, { id: "ok", request: "" }, { id: "ok" }, { id: "ok", request: "x", more: 1 }]) {
    assert.equal((await f.call("POST", `/__hui/bots/juno/calls/${one}/delegations`, body))?.status, 400, JSON.stringify(body));
  }
  assert.deepEqual(await f.call("POST", `/__hui/bots/juno/calls/${one}/heartbeat`), { status: 200, body: { ok: true } });
  assert.equal((await f.call("POST", "/__hui/bots/juno/calls/0f8fad5b-d9cb-469f-a165-70867728950e/heartbeat"))?.status, 404);
  assert.equal((await f.call("GET", `/__hui/bots/juno/calls/${one}/lines`))?.status, 405);

  assert.deepEqual(await f.call("DELETE", `/__hui/bots/juno/calls/${one}`), { status: 200, body: { ended: true } });
  assert.deepEqual(await f.call("DELETE", `/__hui/bots/juno/calls/${one}`), { status: 200, body: { ended: false } });
  assert.equal((await f.call("POST", `/__hui/bots/juno/calls/${one}/lines`, { lines: [{ role: "assistant", text: "Bye!" }] }))?.status, 200, "the last lines after the hang-up");
  assert.equal((await f.call("POST", `/__hui/bots/juno/calls/${one}/delegations`, { id: "late", request: "x" }))?.status, 404, "no task after it");
  assert.equal((await f.call("POST", "/__hui/bots/juno/calls", { sdp: OFFER }))?.status, 201, "the slot is free again");
  void two;
});

test("lines are bounded and checked; an implausible time is the gateway's now", () => {
  const now = Date.parse("2026-10-06T14:00:00Z");
  assert.deepEqual(checkLines([{ role: "user", text: "  hi  ", at: now - 1_000 }, { role: "assistant", text: "yo", at: 42 }], now), [
    { role: "user", text: "hi", at: now - 1_000 }, { role: "assistant", text: "yo", at: now },
  ]);
  for (const raw of [[], "x", [{ role: "system", text: "x" }], [{ role: "user", text: " " }], [{ role: "user", text: "x".repeat(CALL_LIMITS.line + 1) }],
    [{ role: "user", text: "x", extra: true }], Array.from({ length: CALL_LIMITS.lines + 1 }, () => ({ role: "user", text: "x" }))]) {
    assert.throws(() => checkLines(raw, now), /line|lines/u, JSON.stringify(raw).slice(0, 40));
  }
});
