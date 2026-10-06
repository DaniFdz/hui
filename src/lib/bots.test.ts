import assert from "node:assert/strict";
import test from "node:test";
import { applyBotsUpdate, botInputFromDraft, botMemoryPageUrl, BotMemoryUnavailableError, botPatchFromDraft, isBotSession, isNewBotsFrame, loadBotMemory, loadBots, parseBotsUpdate, subscribeBots, parseBot, parseBotList, parseBotMemory, parseBotMemoryStatus, upsertBot, withoutBotSessions, type BotDraft, type BotView } from "./bots.ts";
import type { SessionGroup, SessionView } from "./sessions-store.ts";

const RECORD = {
  id: "b1",
  handle: "scout",
  name: "Scout",
  title: "Research assistant",
  instructions: "A gateway from before SOUL.md: ignored.",
  cwd: "/home/me/.config/hui/bots/b1",
  model: "anthropic/claude",
  thinking: "medium",
  avatar: { emoji: "🔭", color: "#5B9CF6" },
  sessionId: "s1",
  createdAt: "2026-10-05T08:00:00.000Z",
  updatedAt: "2026-10-05T09:00:00.000Z",
  status: "running",
  soul: true,
  lastMessage: { role: "assistant", text: "Done:\n  three   links", at: "2026-10-05T09:00:00.000Z" },
  unread: true,
  memory: {
    messages: 40, built: 38, pending: 2, viewBytes: 92_000, viewLines: 31, waiting: true,
    failing: { node: "1+4", error: "429 rate limited", since: "2026-10-05T08:59:00.000Z" },
    usage: { calls: 12, input: 48_000, output: 1_200, cacheRead: 30_000, cacheWrite: 2_000, cost: 0.0421 },
    junk: "x",
  },
  routines: 2,
};

const USAGE = { calls: 12, input: 48_000, output: 1_200, cacheRead: 30_000, cacheWrite: 2_000, cost: 0.0421 };
const NO_USAGE = { calls: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };

test("a complete bot record keeps its fields and narrows display text", () => {
  const bot = parseBot(RECORD);
  assert.deepEqual(bot, {
    id: "b1",
    handle: "scout",
    name: "Scout",
    title: "Research assistant",
    model: "anthropic/claude",
    thinking: "medium",
    cwd: "/home/me/.config/hui/bots/b1",
    avatar: { emoji: "🔭", color: "#5b9cf6" },
    sessionId: "s1",
    createdAt: "2026-10-05T08:00:00.000Z",
    updatedAt: "2026-10-05T09:00:00.000Z",
    status: "running",
    soul: true,
    lastMessage: { role: "assistant", text: "Done: three links", at: "2026-10-05T09:00:00.000Z" },
    unread: true,
    memory: { messages: 40, built: 38, pending: 2, viewBytes: 92_000, viewLines: 31, waiting: true, failing: { node: "1+4", error: "429 rate limited", since: "2026-10-05T08:59:00.000Z" }, usage: USAGE },
    routines: 2,
  });
});

test("records without identity are skipped and junk lands on safe defaults", () => {
  for (const value of [null, "bot", [], { id: "b" }, { id: "b", name: "B" }, { name: "B", sessionId: "s" }, { id: " ", name: "B", sessionId: "s" }]) {
    assert.equal(parseBot(value), undefined, JSON.stringify(value));
  }
  const bot = parseBot({ id: "b", name: " Bee ", sessionId: "s", status: "dancing", soul: "yes", unread: "yes", routines: -3, hidden: "true", avatar: { color: "blue" }, lastMessage: { role: "system", text: "x", at: "now" }, memory: "full" });
  assert.deepEqual(bot, { id: "b", handle: "", name: "Bee", cwd: "", sessionId: "s", createdAt: "", updatedAt: "", status: "idle", soul: false, unread: false, routines: 0 });
  assert.deepEqual(parseBot({ id: "b", name: "B", sessionId: "s", hidden: true, archived: true })?.hidden, true);
});

test("a bot list skips invalid entries and keeps the first of duplicate ids", () => {
  const list = parseBotList({ bots: [RECORD, { id: "b1", name: "Copy", sessionId: "s9" }, 7, { id: "b2", name: "Ledger", sessionId: "s2" }] });
  assert.deepEqual(list.map((bot) => [bot.id, bot.name]), [["b1", "Scout"], ["b2", "Ledger"]]);
  assert.deepEqual(parseBotList({}), []);
  assert.deepEqual(parseBotList({ bots: "none" }), []);
});

test("memory status counts are whole and failures need an error to show", () => {
  assert.deepEqual(parseBotMemoryStatus({ messages: 3.7, built: "2", pending: -1, viewBytes: 512, viewLines: 2.5, failing: { node: "0+1" } }), { messages: 3, built: 0, pending: 0, viewBytes: 512, viewLines: 2, usage: NO_USAGE });
  assert.deepEqual(parseBotMemoryStatus({ messages: 1, built: 0, pending: 1, viewBytes: 9, failing: { error: "timeout" } })?.failing, { node: "", error: "timeout", since: "" });
  assert.equal(parseBotMemoryStatus(undefined), undefined);
  assert.deepEqual(parseBotMemory({ status: { messages: 1, built: 1, pending: 0, viewBytes: 20, viewLines: 1, usage: USAGE }, view: "<chat>\n0+1|user: hi\n</chat>" }), {
    status: { messages: 1, built: 1, pending: 0, viewBytes: 20, viewLines: 1, usage: USAGE },
    view: "<chat>\n0+1|user: hi\n</chat>",
  });
  assert.throws(() => parseBotMemory({ view: "" }), /memory status/u);
});

test("the compactor's usage keeps whole token counts and a cost only when one was reported", () => {
  const usage = (value: unknown) => parseBotMemoryStatus({ messages: 1, usage: value })?.usage;
  assert.deepEqual(usage(USAGE), USAGE);
  assert.deepEqual(usage({ calls: 2.9, input: "10", output: -4, cacheRead: Number.NaN, cost: -1 }), { ...NO_USAGE, calls: 2 });
  assert.deepEqual(usage({ calls: 1, input: 1, output: 1, cost: Number.POSITIVE_INFINITY }), { ...NO_USAGE, calls: 1, input: 1, output: 1 });
  assert.deepEqual(usage(undefined), NO_USAGE, "an older gateway without usage reports none");
});

test("stream frames update bots in place and replace the list when they carry its order", () => {
  const scout = parseBot(RECORD) as BotView;
  const ledger = parseBot({ id: "b2", name: "Ledger", sessionId: "s2" }) as BotView;
  const coach = parseBot({ id: "b3", name: "Coach", sessionId: "s3" }) as BotView;
  assert.deepEqual(applyBotsUpdate([scout, ledger], { upserts: [{ ...ledger, status: "running" }] }).map((bot) => [bot.id, bot.status]), [["b1", "running"], ["b2", "running"]]);
  assert.deepEqual(applyBotsUpdate([scout], { upserts: [coach] }).map(({ id }) => id), ["b1", "b3"], "a new bot joins at the end until an order arrives");
  assert.deepEqual(applyBotsUpdate([scout, ledger], { ids: ["b3", "b1"], upserts: [coach] }).map(({ id }) => id), ["b3", "b1"], "ids drop bots no longer listed");
  assert.deepEqual(parseBotsUpdate({ revision: 4, ids: ["b1", 2], upserts: [RECORD, { id: "x" }] }), { revision: 4, ids: ["b1"], upserts: [scout] });
  assert.equal(parseBotsUpdate({ ids: [], upserts: [] }), undefined);
});

test("a reconnect's cached first frame at the applied revision is a replay, not news", () => {
  assert.equal(isNewBotsFrame(1_000, true, 0), true, "the first list of a fresh page");
  assert.equal(isNewBotsFrame(1_007, true, 1_007), false, "the gateway's cached list after a gap: already shown");
  assert.equal(isNewBotsFrame(1_009, true, 1_007), true, "changes made while this client was away");
  assert.equal(isNewBotsFrame(900, true, 1_007), true, "a gateway that started again");
  assert.equal(isNewBotsFrame(1_008, false, 1_007), true);
  assert.equal(isNewBotsFrame(1_007, false, 1_007), false);
  assert.equal(isNewBotsFrame(1_006, false, 1_007), false);
});

test("the bot stream reads SSE frames, reports a gateway without it, and stops when asked", async () => {
  const encoder = new TextEncoder();
  const frames = [
    `event: bots\ndata: ${JSON.stringify({ revision: 1, ids: ["b1"], upserts: [RECORD] })}\n\n`,
    ": heartbeat\n\n",
    `event: bots\ndata: ${JSON.stringify({ revision: 2, upserts: [{ ...RECORD, status: "idle" }] })}\n\n`,
  ];
  const updates: [number, boolean][] = [];
  const states: string[] = [];
  let stop = () => {};
  const done = new Promise<void>((resolve) => {
    stop = subscribeBots({
      onUpdate: (update, first) => {
        updates.push([update.revision, first]);
        if (update.revision === 2) resolve();
      },
      onConnection: (state) => states.push(state),
    }, async (_url, init) => new Response(new ReadableStream({
      start(controller) {
        for (const frame of frames) controller.enqueue(encoder.encode(frame));
        (init?.signal as AbortSignal | undefined)?.addEventListener("abort", () => controller.error(new Error("aborted")));
      },
    }), { status: 200, headers: { "content-type": "text/event-stream" } }));
  });
  await done;
  stop();
  assert.deepEqual(updates, [[1, true], [2, false]]);
  assert.deepEqual(states, ["live"]);

  const unsupported = await new Promise<string>((resolve) => {
    subscribeBots({ onUpdate: () => {}, onConnection: resolve }, async () => new Response("{}", { status: 404 }));
  });
  assert.equal(unsupported, "unsupported");
});

test("the memory page is the gateway's own route, which a same-origin link opens", () => {
  assert.equal(botMemoryPageUrl("b1"), "/__hui/bots/b1/memory/html");
  assert.equal(botMemoryPageUrl("b 1/x"), "/__hui/bots/b%201%2Fx/memory/html", "an id never escapes its path segment");
});

test("memory reads tell a memory the gateway cannot read apart from a failed read", async () => {
  const original = globalThis.fetch;
  const answers = [
    new Response(JSON.stringify({ error: "@scout's chat has no OptChat memory in this gateway." }), { status: 503 }),
    new Response(JSON.stringify({ error: "unknown bot: x" }), { status: 404 }),
    new Response(JSON.stringify({ status: { messages: 2, built: 1, pending: 1, viewBytes: 40, viewLines: 1, usage: NO_USAGE }, view: "<chat>\n0+1|user: hi\n</chat>" }), { status: 200 }),
  ];
  const urls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    urls.push(String(input));
    assert.equal(new Headers(init?.headers).get("x-hui"), "1");
    return answers.shift()!;
  }) as typeof fetch;
  try {
    await assert.rejects(loadBotMemory("b 1"), (error: unknown) => error instanceof BotMemoryUnavailableError && /no OptChat memory/u.test((error as Error).message));
    await assert.rejects(loadBotMemory("b1"), (error: unknown) => !(error instanceof BotMemoryUnavailableError) && /unknown bot/u.test((error as Error).message));
    assert.deepEqual(await loadBotMemory("b1"), { status: { messages: 2, built: 1, pending: 1, viewBytes: 40, viewLines: 1, usage: NO_USAGE }, view: "<chat>\n0+1|user: hi\n</chat>" });
    assert.equal(urls[0], "/__hui/bots/b%201/memory");
  } finally {
    globalThis.fetch = original;
  }
});

test("reading the list asks for active and archived bots, as the stream lists both", async () => {
  const original = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    const bots = url.endsWith("?archived=1") ? [{ id: "b9", name: "Old", sessionId: "s9", archived: true }, RECORD] : [RECORD, { id: "b2", name: "Ledger", sessionId: "s2" }];
    return new Response(JSON.stringify({ bots }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    const bots = await loadBots();
    assert.deepEqual(bots.map((bot) => [bot.id, bot.archived === true]), [["b1", false], ["b2", false], ["b9", true]], "a bot listed twice keeps its first copy");
    assert.deepEqual(urls.toSorted(), ["/__hui/bots", "/__hui/bots?archived=1"]);
  } finally {
    globalThis.fetch = original;
  }
});

const EMPTY_DRAFT: BotDraft = { name: "", title: "", cwd: "", emoji: "", model: "", thinking: "", memoryModel: "" };

test("a new bot sends its name and only the optional fields that were filled in", () => {
  assert.deepEqual(botInputFromDraft({ ...EMPTY_DRAFT, name: "  Scout " }), { name: "Scout" });
  assert.deepEqual(botInputFromDraft({
    name: "Scout", title: " Researcher ", cwd: " ~/bots/scout ", emoji: "🔭",
    model: "anthropic/claude", thinking: "high", memoryModel: "openai/mini",
  }), {
    name: "Scout", title: "Researcher", cwd: "~/bots/scout",
    model: "anthropic/claude", thinking: "high", memoryModel: "openai/mini", avatar: { emoji: "🔭" },
  });
});

test("an edit sends only what changed, clears emptied fields and keeps an untouched workspace out", () => {
  const bot = parseBot(RECORD) as BotView;
  const unchanged: BotDraft = { name: "Scout", title: "Research assistant", cwd: bot.cwd, emoji: "🔭", model: "anthropic/claude", thinking: "medium", memoryModel: "" };
  assert.deepEqual(botPatchFromDraft(bot, unchanged), {});
  assert.deepEqual(botPatchFromDraft(bot, { ...unchanged, name: "Scout II", title: "", cwd: "" }), { name: "Scout II", title: "" });
  assert.deepEqual(botPatchFromDraft(bot, { ...unchanged, cwd: "/srv/scout", model: "openai/gpt", thinking: "high", memoryModel: "openai/mini" }), { cwd: "/srv/scout", model: "openai/gpt", thinking: "high", memoryModel: "openai/mini" });
  assert.deepEqual(botPatchFromDraft(bot, { ...unchanged, model: "", thinking: "" }), { model: "", thinking: "" }, "Gateway default clears the chat's model and thinking");
  assert.deepEqual(botPatchFromDraft({ ...bot, model: undefined, thinking: undefined }, { ...unchanged, model: "", thinking: "" }), {}, "a bot already on the defaults stays untouched");
  assert.deepEqual(botPatchFromDraft({ ...bot, model: undefined }, unchanged), { model: "anthropic/claude" }, "a model chosen for a bot on the default");
  assert.deepEqual(botPatchFromDraft({ ...bot, memoryModel: "openai/mini" }, unchanged), { memoryModel: "" }, "an emptied memory model goes back to the bot's own");
  assert.deepEqual(botPatchFromDraft(bot, { ...unchanged, emoji: "" }), { avatar: { emoji: "" } }, "removing the emoji clears only that key");
  assert.deepEqual(botPatchFromDraft(bot, { ...unchanged, emoji: "🦉" }), { avatar: { emoji: "🦉" } });
  assert.deepEqual(botPatchFromDraft(bot, { ...unchanged, name: "  " }), {}, "a blank name is never sent");
});

test("a confirmed record replaces its old copy or joins the list", () => {
  const scout = parseBot(RECORD) as BotView;
  const ledger = parseBot({ id: "b2", name: "Ledger", sessionId: "s2" }) as BotView;
  assert.deepEqual(upsertBot([scout, ledger], { ...ledger, name: "Ledger II" }).map(({ name }) => name), ["Scout", "Ledger II"]);
  assert.deepEqual(upsertBot([scout], ledger).map(({ id }) => id), ["b1", "b2"]);
});

function session(id: string, group: string, overrides: Partial<SessionView> = {}): SessionView {
  return { id, title: id, group, cwd: "/work", tool: "durable", status: "idle", createdAt: "2026-10-05T00:00:00.000Z", updatedAt: "2026-10-05T00:00:00.000Z", ...overrides };
}

test("bot chats leave every session list while groups keep their meaning", () => {
  const scout = session("bot-chat", "", { bot: { id: "b1", handle: "scout", name: "Scout" } });
  const ledger = session("ledger-chat", "Work", { bot: { id: "b2", handle: "ledger", name: "Ledger" } });
  const plain = session("plain", "Work");
  const work: SessionGroup = { label: "Work", sessions: [plain, ledger] };
  const empty: SessionGroup = { label: "Empty", sessions: [] };
  const groups: SessionGroup[] = [work, empty, { label: "Bots only", sessions: [session("b3-chat", "Bots only", { bot: { id: "b3", handle: "c", name: "C" } })] }, { label: "ungrouped", sessions: [scout] }];
  const filtered = withoutBotSessions(groups);
  assert.deepEqual(filtered.map((group) => [group.label, group.sessions.map(({ id }) => id)]), [["Work", ["plain"]], ["Empty", []], ["Bots only", []]]);
  assert.equal(filtered[1], empty, "a group without bot chats keeps its identity");
  assert.equal(isBotSession(scout), true);
  assert.equal(isBotSession(plain), false);
  // OTHER stays while it still lists ordinary sessions.
  assert.deepEqual(withoutBotSessions([{ label: "ungrouped", sessions: [scout, session("loose", "")] }]).map((group) => group.sessions.map(({ id }) => id)), [["loose"]]);
});
