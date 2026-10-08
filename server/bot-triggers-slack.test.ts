import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { createSlackFake, type FakeSlack, type FakeSlackMessage, type FakeSlackState } from "../e2e/slack-fixture.mjs";
import { pollSlack, pullRequestLinks, SLACK_CATCH_UP_MS, SlackPeople, SlackPoller, slackPlainText, threadOf, type SlackEvent, type SlackWants } from "./bot-triggers-slack.ts";
import { slackCursorStore } from "./bot-triggers-store.ts";
import { SlackClient, SlackConfigStore, SlackConnector } from "./slack.ts";

const TOKEN = "xoxp-1111-2222-3333-abcdefabcdef";
const NEW_TOKEN = "xoxp-4444-5555-6666-abcdefabcdef";
const ME = "U0OPERATOR";
const IDENTITY = { userId: ME, user: "dani", teamId: "T0ACME", team: "Acme", url: "https://acme.slack.com/" };
const START = Date.parse("2026-10-08T09:00:00.000Z");
const MINUTE = 60_000;
const ORIGIN = "http://127.0.0.1:1";
const PR = "https://github.com/acme/widgets/pull/42";

const REVIEWS = { id: "C0REVIEWS", name: "team-reviews" };
const RANDOM = { id: "C0RANDOM", name: "random" };
const SHARED = { id: "C0PARTNER", name: "partner-acme", is_ext_shared: true, is_shared: true };
const GROUP_DM = { id: "G0TRIO", name: "mpdm-maria--bob--dani-1", is_mpim: true };
const dm = (with_: string) => ({ id: `D0${with_.slice(2)}`, name: with_, is_im: true });

const person = (id: string, name: string, display: string, extra: Record<string, unknown> = {}) => ({ id, name, team_id: "T0ACME", real_name: display, profile: { display_name: display }, is_bot: false, ...extra });
const USERS = {
  U0MARIA: person("U0MARIA", "maria", "María López"),
  U0BOB: person("U0BOB", "bob", "Bob Builder"),
  U0CIBOT: person("U0CIBOT", "ci-bot", "CI bot", { is_bot: true }),
  U0PARTNER: person("U0PARTNER", "pat", "Pat Partner", { team_id: "T0OTHER", is_stranger: true }),
  [ME]: person(ME, "dani", "Dani"),
};

/** A Slack timestamp for a time, with a sequence so two messages in one second differ. */
let sequence = 0;
const ts = (time: number) => `${Math.floor(time / 1_000)}.${String(++sequence).padStart(6, "0")}`;

type Harness = {
  fake: FakeSlack;
  clock: { now: number };
  events: SlackEvent[];
  scheduled: { ms: number; cancelled: boolean }[];
  poller: SlackPoller;
  connector: SlackConnector;
  reports: string[];
  dir: string;
  post(message: Omit<FakeSlackMessage, "ts"> & { at?: number; ts?: string }): FakeSlackMessage;
  newPoller(): SlackPoller;
};

async function harness(t: TestContext, options: { state?: Partial<FakeSlackState>; wants?: SlackWants; dir?: string } = {}): Promise<Harness> {
  const dir = options.dir ?? await mkdtemp(join(tmpdir(), "hui-check-slack-triggers-"));
  if (!options.dir) t.after(() => rm(dir, { recursive: true, force: true }));
  const fake = createSlackFake({ tokens: { [TOKEN]: { ...IDENTITY } }, users: { ...USERS }, messages: [], ...options.state });
  const clock = { now: START };
  const connector = new SlackConnector({ store: new SlackConfigStore(join(dir, "slack.json")), fetch: fake.fetch, origin: ORIGIN, now: () => clock.now });
  await connector.connect(TOKEN);
  const events: SlackEvent[] = [];
  const scheduled: { ms: number; cancelled: boolean }[] = [];
  const reports: string[] = [];
  const make = () => new SlackPoller({
    connector,
    cursors: slackCursorStore(join(dir, "cursor.json")),
    onEvents: (found) => { events.push(...found); },
    intervalMs: MINUTE,
    firstDelayMs: 0,
    now: () => clock.now,
    schedule: (_run, ms) => {
      const entry = { ms, cancelled: false };
      scheduled.push(entry);
      return () => { entry.cancelled = true; };
    },
    report: (_level, action) => { reports.push(action); },
  });
  const poller = make();
  t.after(() => poller.stop());
  await poller.sync(options.wants ?? { mention: true, dm: true });
  return {
    fake, clock, events, scheduled, poller, connector, reports, dir,
    post(message) {
      const { at, ...rest } = message;
      const posted = { ...rest, ts: message.ts ?? ts(at ?? clock.now - 20_000) } as FakeSlackMessage;
      fake.state.messages.push(posted);
      return posted;
    },
    newPoller: make,
  };
}

const kinds = (events: readonly SlackEvent[]) => events.map((event) => [event.kind, event.person.name, event.summary]);

test("the first poll is a silent baseline; then a mention and a DM each arrive once, with who, where, the message and its permalink", async (t) => {
  const h = await harness(t);
  h.post({ channel: REVIEWS, user: "U0MARIA", text: `<@${ME}> an old ping from before HUI watched`, at: START - 10 * MINUTE });
  await h.poller.pollNow();
  assert.equal(h.events.length, 0, "a new watch starts from now");
  h.clock.now += MINUTE;
  const mention = h.post({ channel: REVIEWS, user: "U0MARIA", text: `<@${ME}> could you review <${PR}|acme/widgets#42>? &lt;3` });
  h.post({ channel: dm("U0BOB"), user: "U0BOB", text: "got a minute for a quick question?" });
  h.post({ channel: REVIEWS, user: ME, text: `note to self <@${ME}>` });
  h.post({ channel: RANDOM, user: "U0BOB", text: "<@U0MARIA> lunch?" });
  h.post({ channel: GROUP_DM, user: "U0BOB", text: "a group DM that doesn't mention anyone" });
  await h.poller.pollNow();
  assert.deepEqual(kinds(h.events), [
    ["mention", "maria", "@maria in #team-reviews: acme/widgets#42"],
    ["dm", "bob", "@bob in a DM: got a minute for a quick question?"],
  ], "never his own message, nor a mention of someone else, nor a group DM without a mention");
  const [first] = h.events;
  assert.equal(first?.key, `C0REVIEWS:${mention.ts}`);
  assert.deepEqual(first?.links, [PR]);
  assert.equal(first?.person.displayName, "María López");
  assert.match(first?.details ?? "", /^From María López \(@maria\), in #team-reviews\nhttps:\/\/acme\.slack\.com\/archives\/C0REVIEWS\/p\d+\n {2}> @dani could you review acme\/widgets#42 \(https:\/\/github\.com\/acme\/widgets\/pull\/42\)\? <3\nPull requests: https:\/\/github\.com\/acme\/widgets\/pull\/42$/u);
  assert.match(h.events[1]?.details ?? "", /^From Bob Builder \(@bob\), a direct message to you\n/u);
  h.clock.now += MINUTE;
  await h.poller.pollNow();
  assert.equal(h.events.length, 2, "each message fires at most once");
  assert.deepEqual(h.poller.status()?.error, undefined);
  assert.ok(h.poller.status()?.polledAt);
});

test("only what enabled triggers want is asked: a mention-only watch never searches DMs", async (t) => {
  const h = await harness(t, { wants: { mention: true, dm: false } });
  await h.poller.pollNow();
  h.clock.now += MINUTE;
  h.post({ channel: dm("U0BOB"), user: "U0BOB", text: "hi" });
  await h.poller.pollNow();
  const queries = h.fake.log.filter((entry) => entry.method === "search.messages").map((entry) => entry.params["query"]);
  assert.ok(queries.length >= 1 && queries.every((query) => query?.startsWith(`<@${ME}> after:`)), JSON.stringify(queries));
  assert.equal(h.events.length, 0);
});

test("search pages are read until one reaches what the previous poll covered; past five pages a catch-up says it left some out", async (t) => {
  const h = await harness(t, { wants: { mention: true, dm: false } });
  await h.poller.pollNow();
  h.clock.now += MINUTE;
  for (let index = 0; index < 230; index += 1) h.post({ channel: REVIEWS, user: "U0MARIA", text: `<@${ME}> ping ${index}`, at: h.clock.now - 50_000 + index * 100 });
  const before = h.fake.log.length;
  await h.poller.pollNow();
  assert.equal(h.events.length, 230);
  assert.deepEqual(h.fake.log.slice(before).filter((entry) => entry.method === "search.messages").map((entry) => entry.params["page"]), ["1", "2", "3"]);
  assert.match(h.events[0]?.summary ?? "", /ping 0$/u, "oldest first");

  const people = new SlackPeople(() => START);
  const reader = new SlackClient(TOKEN, { origin: ORIGIN, fetch: h.fake.fetch });
  const cursor = { userId: ME, teamId: "T0ACME", baselineAt: new Date(START).toISOString(), checkedTo: h.clock.now, seen: {} };
  h.clock.now += 10 * MINUTE;
  for (let index = 0; index < 620; index += 1) h.post({ channel: RANDOM, user: "U0BOB", text: `<@${ME}> flood ${index}`, at: h.clock.now - 5 * MINUTE + index * 100 });
  const outcome = await pollSlack({ reader, me: IDENTITY, cursor, wants: { mention: true, dm: false }, now: () => h.clock.now, people });
  assert.equal(outcome.truncated, true);
  assert.equal(outcome.events.length, 500, "five pages of a hundred");
});

test("edits never fire: an older message that shows up later is skipped, a late-indexed new one counts, a deleted one is gone", async (t) => {
  const h = await harness(t);
  await h.poller.pollNow();
  const previous = h.clock.now;
  h.clock.now += MINUTE;
  // Posted before the previous poll, edited since to add the mention.
  h.post({ channel: REVIEWS, user: "U0MARIA", text: `<@${ME}> (added in an edit)`, at: previous - 30_000, edited: { user: "U0MARIA", ts: ts(h.clock.now - 5_000) } });
  // Posted just before the previous poll, and only indexed now: within the allowance, it counts.
  h.post({ channel: REVIEWS, user: "U0BOB", text: `<@${ME}> indexed late`, at: previous - 30_000 });
  // Posted long before the previous poll and only indexed now: past the allowance, it doesn't.
  h.post({ channel: REVIEWS, user: "U0BOB", text: `<@${ME}> far too late`, at: previous - 10 * MINUTE });
  const deleted = h.post({ channel: REVIEWS, user: "U0BOB", text: `<@${ME}> deleted before the poll` });
  h.fake.state.messages = h.fake.state.messages.filter((message) => message !== deleted);
  await h.poller.pollNow();
  assert.deepEqual(kinds(h.events), [["mention", "bob", "@bob in #team-reviews: indexed late"]]);
});

test("a thread reply without a link counts its thread parent's, says what it replies to, and notes a parent it can't read", async (t) => {
  const parent = { channel: REVIEWS, user: "U0BOB", text: `Upload retries are ready: ${PR}`, ts: ts(START - 60 * MINUTE) };
  const h = await harness(t, { state: { parents: [parent] } });
  await h.poller.pollNow();
  h.clock.now += MINUTE;
  h.post({ channel: REVIEWS, user: "U0MARIA", text: `<@${ME}> can you take a look?`, thread_ts: parent.ts });
  h.post({ channel: REVIEWS, user: "U0MARIA", text: `<@${ME}> and this one https://github.com/acme/gadgets/pull/7`, thread_ts: parent.ts });
  await h.poller.pollNow();
  assert.equal(h.events.length, 2);
  const [reply, linked] = h.events;
  assert.deepEqual([reply?.links, reply?.linksFromThread], [[PR], true]);
  assert.match(reply?.details ?? "", /, replying in a thread\n/u);
  assert.match(reply?.details ?? "", /It replies to Bob Builder \(@bob\):\n {2}> Upload retries are ready: https:\/\/github\.com\/acme\/widgets\/pull\/42\n/u);
  assert.match(reply?.details ?? "", /Pull requests: https:\/\/github\.com\/acme\/widgets\/pull\/42 \(linked in the thread it replies to\)$/u);
  assert.deepEqual([linked?.links, linked?.linksFromThread], [["https://github.com/acme/gadgets/pull/7"], false]);
  assert.equal(h.fake.log.filter((entry) => entry.method === "conversations.replies").length, 1, "a reply with its own link needs no parent");
  assert.equal(threadOf({ ts: parent.ts, permalink: `https://acme.slack.com/archives/C0REVIEWS/p1?thread_ts=${parent.ts}` }), undefined, "a thread's parent isn't a reply");

  h.fake.state.tokens[TOKEN]!.scopes = ["search:read", "users:read"];
  h.clock.now += MINUTE;
  h.post({ channel: REVIEWS, user: "U0MARIA", text: `<@${ME}> again?`, thread_ts: parent.ts });
  await h.poller.pollNow();
  assert.match(h.events[2]?.details ?? "", /The thread it replies to could not be read: the token lacks the history scope for this kind of conversation\./u);
  assert.deepEqual(h.events[2]?.links, []);
});

test("bots, apps and people outside the workspace are marked; without users:read, a shared channel's foreign team still is", async (t) => {
  const h = await harness(t);
  await h.poller.pollNow();
  h.clock.now += MINUTE;
  h.post({ channel: REVIEWS, user: "U0CIBOT", text: `<@${ME}> build 812 failed` });
  h.post({ channel: REVIEWS, bot_id: "B0DEPLOY", username: "deploys", subtype: "bot_message", text: `<@${ME}> deploy done` });
  h.post({ channel: SHARED, user: "U0PARTNER", text: `<@${ME}> from the partner side`, team: "T0OTHER" });
  await h.poller.pollNow();
  assert.deepEqual(h.events.map((event) => [event.person.name, event.person.bot, event.person.external]), [["ci-bot", true, false], ["deploys", true, false], ["pat", false, true]]);
  assert.match(h.events[2]?.details ?? "", /Pat Partner \(@pat\) \(outside your workspace, Slack Connect\)/u);

  h.fake.state.tokens[TOKEN]!.scopes = ["search:read"];
  const people = new SlackPeople(() => h.clock.now);
  const reader = new SlackClient(TOKEN, { origin: ORIGIN, fetch: h.fake.fetch });
  h.clock.now += 5 * MINUTE;
  const cursor = { userId: ME, teamId: "T0ACME", baselineAt: new Date(START).toISOString(), checkedTo: h.clock.now, seen: {} };
  h.clock.now += MINUTE;
  h.post({ channel: SHARED, user: "U0NEWPARTNER", username: "newpat", text: `<@${ME}> hi`, user_team: "T0OTHER" });
  const outcome = await pollSlack({ reader, me: IDENTITY, cursor, wants: { mention: true, dm: true }, now: () => h.clock.now, people });
  assert.deepEqual(outcome.events.map((event) => [event.person.name, event.person.external]), [["newpat", true]]);
});

test("a 429 waits as long as Slack's Retry-After says, and loses nothing", async (t) => {
  const h = await harness(t);
  await h.poller.pollNow();
  h.clock.now += MINUTE;
  h.post({ channel: REVIEWS, user: "U0MARIA", text: `<@${ME}> review?` });
  h.fake.state.rateLimited = { method: "search.messages", retryAfter: 120, times: 1 };
  await h.poller.pollNow();
  assert.equal(h.events.length, 0);
  assert.match(h.poller.status()?.error ?? "", /rate limit/u);
  assert.equal(h.scheduled.filter((entry) => !entry.cancelled).at(-1)?.ms, 120_000, "the next read waits for Retry-After");
  h.clock.now += 2 * MINUTE;
  await h.poller.pollNow();
  assert.deepEqual(kinds(h.events), [["mention", "maria", "@maria in #team-reviews: review?"]]);
  assert.equal(h.poller.status()?.error, undefined);
});

test("a revoked or invalid token parks the poller and the status says to connect again; connecting again resumes it", async (t) => {
  const h = await harness(t);
  await h.poller.pollNow();
  h.fake.state.tokens[TOKEN]!.revoked = true;
  h.clock.now += MINUTE;
  h.post({ channel: REVIEWS, user: "U0MARIA", text: `<@${ME}> while the token was revoked` });
  await h.poller.pollNow();
  assert.equal(h.connector.revoked, true);
  assert.equal((await h.connector.view({ active: true })).message, "Token revoked or expired: connect again.");
  assert.match(h.poller.status()?.error ?? "", /revoked or expired/u);
  assert.ok(h.scheduled.every((entry) => entry.cancelled), "nothing more is scheduled: Slack would refuse it again");
  const requests = h.fake.log.length;
  await h.poller.pollNow();
  assert.equal(h.fake.log.length, requests, "parked: Slack isn't asked again");
  h.fake.state.tokens[NEW_TOKEN] = { ...IDENTITY };
  h.clock.now += 5 * MINUTE;
  await h.connector.connect(NEW_TOKEN);
  assert.ok(h.scheduled.some((entry) => !entry.cancelled), "connecting again schedules a read");
  await h.poller.pollNow();
  assert.deepEqual(kinds(h.events), [["mention", "maria", "@maria in #team-reviews: while the token was revoked"]], "the same member's cursor: what came meanwhile");
  assert.equal(h.events[0]?.catchUp, true);
  h.fake.state.tokens = {};
  h.clock.now += MINUTE;
  await h.poller.pollNow();
  assert.equal((await h.connector.view({ active: true })).status, "revoked", "invalid_auth is a refused token too");
});

test("catch-up: after a restart, after a sleep, and only the last day after a longer gap", async (t) => {
  const h = await harness(t);
  await h.poller.pollNow();
  await h.poller.stop();
  // The gateway was down for ten minutes.
  h.clock.now += 10 * MINUTE;
  h.post({ channel: REVIEWS, user: "U0MARIA", text: `<@${ME}> while HUI was down` });
  const restarted = h.newPoller();
  t.after(() => restarted.stop());
  await restarted.sync({ mention: true, dm: true });
  await restarted.pollNow();
  assert.deepEqual(h.events.map((event) => [event.summary, event.catchUp]), [["@maria in #team-reviews: while HUI was down", true]]);
  h.clock.now += MINUTE;
  h.post({ channel: REVIEWS, user: "U0MARIA", text: `<@${ME}> back to normal` });
  await restarted.pollNow();
  assert.equal(h.events[1]?.catchUp, undefined, "a poll a minute after the last is not a catch-up");
  // The laptop slept for eight hours: its timer only fires after it wakes.
  h.clock.now += 8 * 60 * MINUTE;
  for (const hour of [7, 5, 1]) h.post({ channel: dm("U0BOB"), user: "U0BOB", text: `ping ${hour} h ago`, at: h.clock.now - hour * 60 * MINUTE });
  await restarted.pollNow();
  assert.deepEqual(h.events.slice(2).map((event) => [event.summary, event.catchUp]), [
    ["@bob in a DM: ping 7 h ago", true], ["@bob in a DM: ping 5 h ago", true], ["@bob in a DM: ping 1 h ago", true],
  ]);
  // Away for thirty hours: what is older than a day was missed for good, and the report says so.
  h.clock.now += 30 * 60 * MINUTE;
  h.post({ channel: REVIEWS, user: "U0MARIA", text: `<@${ME}> 26 hours ago`, at: h.clock.now - 26 * 60 * MINUTE });
  h.post({ channel: REVIEWS, user: "U0MARIA", text: `<@${ME}> an hour ago`, at: h.clock.now - 60 * MINUTE });
  await restarted.pollNow();
  assert.deepEqual(h.events.slice(5).map((event) => event.summary), ["@maria in #team-reviews: an hour ago"]);
  assert.ok(h.reports.includes("slack_catch_up_clipped"));
  assert.equal(SLACK_CATCH_UP_MS, 24 * 60 * MINUTE);
});

test("bots off: nothing is read; on again, what came meanwhile arrives as a catch-up; no trigger: the cursor is forgotten", async (t) => {
  const h = await harness(t);
  await h.poller.pollNow();
  await h.poller.stop();
  const requests = h.fake.log.length;
  h.clock.now += 15 * MINUTE;
  h.post({ channel: REVIEWS, user: "U0MARIA", text: `<@${ME}> while bots were off` });
  await h.poller.pollNow();
  assert.equal(h.fake.log.length, requests, "a stopped poller reads nothing");
  assert.equal(h.poller.status(), undefined);
  await h.poller.sync({ mention: true, dm: true });
  await h.poller.pollNow();
  assert.deepEqual(h.events.map((event) => [event.summary, event.catchUp]), [["@maria in #team-reviews: while bots were off", true]]);
  await h.poller.sync(undefined);
  assert.equal(JSON.parse(await readFile(join(h.dir, "cursor.json"), "utf8")).cursor, undefined, "no trigger reads Slack: where it was is forgotten");
  h.clock.now += 5 * MINUTE;
  h.post({ channel: REVIEWS, user: "U0MARIA", text: `<@${ME}> before watching again` });
  await h.poller.sync({ mention: true, dm: false });
  await h.poller.pollNow();
  assert.equal(h.events.length, 1, "watching again starts with a new baseline");
});

test("Slack markup reads as people see it, and pull request links come from the text, unfurls and blocks", () => {
  const names: Record<string, string> = { U0MARIA: "maria" };
  assert.equal(slackPlainText("<@U0MARIA> and <@U0NOBODY|ghost> in <#C0REVIEWS|team-reviews>, <!here>: see <https://example.com/x|the doc> &amp; <https://example.com/y>", (id) => names[id]),
    "@maria and @ghost in #team-reviews, @here: see the doc (https://example.com/x) & https://example.com/y");
  assert.deepEqual(pullRequestLinks({
    text: "<https://github.com/acme/widgets/pull/42/files|files> and https://www.github.com/acme/widgets/pull/42 and acme/widgets#9 and https://github.com/acme/widgets/issues/3",
    attachments: [{ from_url: "https://github.com/acme/gadgets/pull/7", title_link: "https://github.com/acme/gadgets/pull/7" }],
    blocks: [{ type: "rich_text", elements: [{ type: "link", url: "https://github.com/acme/tools/pull/1" }, { type: "link", url: "https://github.com/acme/more/pull/2" }] }],
  }), ["https://github.com/acme/widgets/pull/42", "https://github.com/acme/gadgets/pull/7", "https://github.com/acme/tools/pull/1"], "each once, pull requests only, three at most");
});
