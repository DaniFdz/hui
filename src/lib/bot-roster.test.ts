import assert from "node:assert/strict";
import test from "node:test";
import {
  botAccessibleName,
  botActivity,
  botActivityAt,
  botAvatar,
  botMatches,
  botPreview,
  compactRelativeTime,
  hiddenBotCount,
  normalizeBotPanel,
  normalizeSidebarTab,
  rosterBots,
  tabAfterKey,
  BOT_AVATAR_TONES,
  SIDEBAR_TABS,
} from "./bot-roster.ts";
import type { BotView } from "./bots.ts";

function bot(id: string, overrides: Partial<BotView> = {}): BotView {
  return {
    id,
    handle: id,
    name: id[0]!.toUpperCase() + id.slice(1),
    cwd: "/bots/" + id,
    sessionId: "s-" + id,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    status: "idle",
    unread: false,
    routines: 0,
    ...overrides,
  };
}

test("the roster orders by latest activity and never lists archived bots", () => {
  const bots = [
    bot("coach", { updatedAt: "2026-10-04T00:00:00.000Z" }),
    bot("scout", { lastMessage: { role: "assistant", text: "hi", at: "2026-10-05T09:58:00.000Z" } }),
    bot("ledger", { lastMessage: { role: "user", text: "sum", at: "2026-10-05T09:00:00.000Z" } }),
    bot("old", { archived: true, lastMessage: { role: "user", text: "x", at: "2026-10-05T10:00:00.000Z" } }),
    bot("quiet", { hidden: true, lastMessage: { role: "user", text: "x", at: "2026-10-05T10:00:00.000Z" } }),
  ];
  assert.deepEqual(rosterBots(bots, { query: "", showHidden: false }).map(({ id }) => id), ["scout", "ledger", "coach"]);
  assert.deepEqual(rosterBots(bots, { query: "", showHidden: true }).map(({ id }) => id), ["quiet", "scout", "ledger", "coach"]);
  assert.equal(hiddenBotCount(bots), 1);
  assert.equal(hiddenBotCount([bot("gone", { hidden: true, archived: true })]), 0);
  // Equal activity falls back to the name, so the order never flickers.
  assert.deepEqual(rosterBots([bot("beta"), bot("alpha")], { query: "", showHidden: false }).map(({ id }) => id), ["alpha", "beta"]);
});

test("activity falls back from the last message to the record's own times", () => {
  assert.equal(botActivityAt(bot("a", { lastMessage: { role: "user", text: "x", at: "2026-10-05T00:00:00.000Z" } })), Date.parse("2026-10-05T00:00:00.000Z"));
  assert.equal(botActivityAt(bot("a", { updatedAt: "nonsense", createdAt: "2026-10-02T00:00:00.000Z" })), Date.parse("2026-10-02T00:00:00.000Z"));
  assert.equal(botActivityAt(bot("a", { updatedAt: "", createdAt: "" })), 0);
});

test("search matches name, handle with or without @, and title, ignoring case", () => {
  const scout = bot("scout", { name: "Scout", handle: "scout-2", title: "Inbox researcher" });
  for (const query of ["", "  ", "sco", "SCOUT", "@scout-2", "scout-2", "inbox", "RESEARCH"]) assert.equal(botMatches(scout, query), true, query);
  for (const query of ["ledger", "@ledger", "assistant"]) assert.equal(botMatches(scout, query), false, query);
  assert.deepEqual(rosterBots([scout, bot("ledger")], { query: "@sco", showHidden: false }).map(({ id }) => id), ["scout"]);
});

test("avatars use the chosen emoji or the first letter on a color stable per bot", () => {
  const plain = botAvatar({ id: "4f0c", name: "ledger" });
  assert.equal(plain.initial, "L");
  assert.equal(plain.emoji, undefined);
  assert.ok(plain.tone >= 0 && plain.tone < BOT_AVATAR_TONES);
  assert.deepEqual(botAvatar({ id: "4f0c", name: "Renamed" }).tone, plain.tone, "a rename keeps the color");
  assert.deepEqual(botAvatar({ id: "x", name: "Ünïcode", avatar: { emoji: "🦉", color: "#a78bfa" } }), { emoji: "🦉", initial: "Ü", color: "#a78bfa", tone: botAvatar({ id: "x", name: "y" }).tone });
  assert.equal(botAvatar({ id: "y", name: "👩‍💻 Dev" }).initial, "👩‍💻", "the initial is a whole grapheme");
  const tones = new Set(["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l"].map((id) => botAvatar({ id, name: id }).tone));
  assert.ok(tones.size > 3, "different bots spread over the palette");
});

test("a row previews the latest message, else the role, else says it is new", () => {
  assert.equal(botPreview({ lastMessage: { role: "assistant", text: "Three links found", at: "x" }, title: "Researcher" }), "Three links found");
  assert.equal(botPreview({ lastMessage: { role: "user", text: "Find three links", at: "x" }, title: "Researcher" }), "You: Find three links");
  assert.equal(botPreview({ title: "Researcher" }), "Researcher");
  assert.equal(botPreview({}), "No messages yet");
});

test("chat-list times are compact", () => {
  const now = Date.parse("2026-10-05T12:00:00.000Z");
  assert.equal(compactRelativeTime(now - 30_000, now), "now");
  assert.equal(compactRelativeTime(now - 2 * 60_000, now), "2m");
  assert.equal(compactRelativeTime(now - 60 * 60_000, now), "1h");
  assert.equal(compactRelativeTime(now - 26 * 3_600_000, now), "1d");
  assert.match(compactRelativeTime(now - 9 * 86_400_000, now), /\S/u);
  assert.equal(compactRelativeTime(0, now), "");
  assert.equal(compactRelativeTime(now + 60_000, now), "now", "clock skew never shows a negative age");
});

test("the row indicator puts a pending question first and memory waits before running", () => {
  assert.equal(botActivity({ status: "waiting", memory: { messages: 1, built: 1, pending: 0, viewBytes: 1, waiting: true } }), "waiting");
  assert.equal(botActivity({ status: "running", memory: { messages: 1, built: 0, pending: 1, viewBytes: 1, waiting: true } }), "summarizing");
  assert.equal(botActivity({ status: "running" }), "running");
  assert.equal(botActivity({ status: "starting" }), "running");
  assert.equal(botActivity({ status: "error" }), "error");
  assert.equal(botActivity({ status: "disconnected" }), "away");
  assert.equal(botActivity({ status: "idle" }), "idle");
  assert.equal(
    botAccessibleName(bot("scout", { name: "Scout", title: "Researcher", status: "running", unread: true, hidden: true, memory: { messages: 2, built: 1, pending: 1, viewBytes: 9, failing: { error: "429" } } })),
    "Scout, Researcher, active now, unread, hidden, memory summaries failing",
  );
});

test("tab strips move with arrows, Home and End and ignore other keys", () => {
  assert.equal(tabAfterKey(SIDEBAR_TABS, "sessions", "ArrowRight"), "bots");
  assert.equal(tabAfterKey(SIDEBAR_TABS, "bots", "ArrowRight"), "sessions");
  assert.equal(tabAfterKey(SIDEBAR_TABS, "sessions", "ArrowLeft"), "bots");
  assert.equal(tabAfterKey(SIDEBAR_TABS, "bots", "Home"), "sessions");
  assert.equal(tabAfterKey(SIDEBAR_TABS, "sessions", "End"), "bots");
  assert.equal(tabAfterKey(SIDEBAR_TABS, "sessions", "Enter"), undefined);
  assert.equal(normalizeSidebarTab("bots"), "bots");
  for (const value of [null, "Bots", "agents", 1]) assert.equal(normalizeSidebarTab(value), "sessions");
});

test("the side panel remembers open/closed and its tab, defaulting open on Routines", () => {
  assert.deepEqual(normalizeBotPanel(null), { open: true, tab: "routines" });
  assert.deepEqual(normalizeBotPanel({ open: false, tab: "memory" }), { open: false, tab: "memory" });
  assert.deepEqual(normalizeBotPanel({ open: "no", tab: "settings" }), { open: true, tab: "routines" });
});
