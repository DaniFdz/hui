import assert from "node:assert/strict";
import test from "node:test";
import { applyBotsUpdate, botInputFromDraft, botPatchFromDraft, inertMemoryPage, isBotSession, parseBotsUpdate, subscribeBots, parseBot, parseBotList, parseBotMemory, parseBotMemoryStatus, upsertBot, withoutBotSessions, type BotDraft, type BotView } from "./bots.ts";
import type { SessionGroup, SessionView } from "./sessions-store.ts";

const RECORD = {
  id: "b1",
  handle: "scout",
  name: "Scout",
  title: "Research assistant",
  instructions: "Find things.",
  cwd: "/home/me/.config/hui/bots/b1",
  model: "anthropic/claude",
  thinking: "medium",
  avatar: { emoji: "🔭", color: "#5B9CF6" },
  sessionId: "s1",
  createdAt: "2026-10-05T08:00:00.000Z",
  updatedAt: "2026-10-05T09:00:00.000Z",
  status: "running",
  lastMessage: { role: "assistant", text: "Done:\n  three   links", at: "2026-10-05T09:00:00.000Z" },
  unread: true,
  memory: { messages: 40, built: 38, pending: 2, viewBytes: 92_000, waiting: true, failing: { node: "1+4", error: "429 rate limited", since: "2026-10-05T08:59:00.000Z" }, junk: "x" },
  routines: 2,
};

test("a complete bot record keeps its fields and narrows display text", () => {
  const bot = parseBot(RECORD);
  assert.deepEqual(bot, {
    id: "b1",
    handle: "scout",
    name: "Scout",
    title: "Research assistant",
    instructions: "Find things.",
    model: "anthropic/claude",
    thinking: "medium",
    cwd: "/home/me/.config/hui/bots/b1",
    avatar: { emoji: "🔭", color: "#5b9cf6" },
    sessionId: "s1",
    createdAt: "2026-10-05T08:00:00.000Z",
    updatedAt: "2026-10-05T09:00:00.000Z",
    status: "running",
    lastMessage: { role: "assistant", text: "Done: three links", at: "2026-10-05T09:00:00.000Z" },
    unread: true,
    memory: { messages: 40, built: 38, pending: 2, viewBytes: 92_000, waiting: true, failing: { node: "1+4", error: "429 rate limited", since: "2026-10-05T08:59:00.000Z" } },
    routines: 2,
  });
});

test("records without identity are skipped and junk lands on safe defaults", () => {
  for (const value of [null, "bot", [], { id: "b" }, { id: "b", name: "B" }, { name: "B", sessionId: "s" }, { id: " ", name: "B", sessionId: "s" }]) {
    assert.equal(parseBot(value), undefined, JSON.stringify(value));
  }
  const bot = parseBot({ id: "b", name: " Bee ", sessionId: "s", status: "dancing", unread: "yes", routines: -3, hidden: "true", avatar: { color: "blue" }, lastMessage: { role: "system", text: "x", at: "now" }, memory: "full" });
  assert.deepEqual(bot, { id: "b", handle: "", name: "Bee", cwd: "", sessionId: "s", createdAt: "", updatedAt: "", status: "idle", unread: false, routines: 0 });
  assert.deepEqual(parseBot({ id: "b", name: "B", sessionId: "s", hidden: true, archived: true })?.hidden, true);
});

test("a bot list skips invalid entries and keeps the first of duplicate ids", () => {
  const list = parseBotList({ bots: [RECORD, { id: "b1", name: "Copy", sessionId: "s9" }, 7, { id: "b2", name: "Ledger", sessionId: "s2" }] });
  assert.deepEqual(list.map((bot) => [bot.id, bot.name]), [["b1", "Scout"], ["b2", "Ledger"]]);
  assert.deepEqual(parseBotList({}), []);
  assert.deepEqual(parseBotList({ bots: "none" }), []);
});

test("memory status counts are whole and failures need an error to show", () => {
  assert.deepEqual(parseBotMemoryStatus({ messages: 3.7, built: "2", pending: -1, viewBytes: 512, failing: { node: "0+1" } }), { messages: 3, built: 0, pending: 0, viewBytes: 512 });
  assert.deepEqual(parseBotMemoryStatus({ messages: 1, built: 0, pending: 1, viewBytes: 9, failing: { error: "timeout" } })?.failing, { node: "", error: "timeout", since: "" });
  assert.equal(parseBotMemoryStatus(undefined), undefined);
  assert.deepEqual(parseBotMemory({ status: { messages: 1, built: 1, pending: 0, viewBytes: 20 }, view: "<chat>\n0+1|user: hi\n</chat>" }), {
    status: { messages: 1, built: 1, pending: 0, viewBytes: 20 },
    view: "<chat>\n0+1|user: hi\n</chat>",
  });
  assert.throws(() => parseBotMemory({ view: "" }), /memory status/u);
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

test("the memory page copy gets a no-script, no-load policy at the top of its head", () => {
  const policy = /<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';/u;
  const page = inertMemoryPage("<!doctype html><html><head><title>Scout</title></head><body>x</body></html>");
  assert.match(page, /^<!doctype html><html><head><meta http-equiv="Content-Security-Policy"/u);
  assert.match(page, /form-action 'none'"><title>Scout<\/title><\/head><body>x<\/body>/u, "the page itself follows unchanged");
  assert.match(inertMemoryPage("<!DOCTYPE html><body>x</body>"), /^<!DOCTYPE html><meta http-equiv/u);
  assert.match(inertMemoryPage("<p>x</p>"), policy);
  assert.match(inertMemoryPage('<html><head lang="en"><style>p{}</style></head></html>'), /<head lang="en"><meta http-equiv/u);
});

const EMPTY_DRAFT: BotDraft = { name: "", title: "", instructions: "", cwd: "", emoji: "", model: "", thinking: "", memoryModel: "" };

test("a new bot sends its name and only the optional fields that were filled in", () => {
  assert.deepEqual(botInputFromDraft({ ...EMPTY_DRAFT, name: "  Scout " }), { name: "Scout" });
  assert.deepEqual(botInputFromDraft({
    name: "Scout", title: " Researcher ", instructions: "Find things.\n", cwd: " ~/bots/scout ", emoji: "🔭",
    model: "anthropic/claude", thinking: "high", memoryModel: "openai/mini",
  }), {
    name: "Scout", title: "Researcher", instructions: "Find things.", cwd: "~/bots/scout",
    model: "anthropic/claude", thinking: "high", memoryModel: "openai/mini", avatar: { emoji: "🔭" },
  });
});

test("an edit sends only what changed, clears emptied fields and keeps an untouched workspace out", () => {
  const bot = parseBot(RECORD) as BotView;
  const unchanged: BotDraft = { name: "Scout", title: "Research assistant", instructions: "Find things.", cwd: bot.cwd, emoji: "🔭", model: "anthropic/claude", thinking: "medium", memoryModel: "" };
  assert.deepEqual(botPatchFromDraft(bot, unchanged), {});
  assert.deepEqual(botPatchFromDraft(bot, { ...unchanged, name: "Scout II", title: "", cwd: "" }), { name: "Scout II", title: "" });
  assert.deepEqual(botPatchFromDraft(bot, { ...unchanged, cwd: "/srv/scout", model: "openai/gpt", thinking: "high", memoryModel: "openai/mini" }), { cwd: "/srv/scout", model: "openai/gpt", thinking: "high", memoryModel: "openai/mini" });
  assert.deepEqual(botPatchFromDraft(bot, { ...unchanged, model: "", thinking: "" }), {}, "a chat's model and thinking change but never clear");
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
