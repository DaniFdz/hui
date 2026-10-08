import assert from "node:assert/strict";
import { test } from "node:test";
import { BOT_TRIGGER_LIMITS } from "../shared/bot-triggers.ts";
import { listenerMatches, parseListenerReport, type ListenerEvent } from "./bot-triggers-listener.ts";
import { TriggerInputError } from "./bot-triggers-input.ts";
import type { HookBody } from "./bot-triggers-webhook.ts";

const NOW = Date.parse("2026-10-08T12:00:00.000Z");
const json = (value: unknown): HookBody => ({ kind: "json", value, bytes: JSON.stringify(value).length, type: "application/json" });
const ping = (extra: Record<string, unknown> = {}) => ({
  id: "G01REVIEWS:1791481674.389319", summary: "@rodrigo in #team-reviews: acme/widgets#42", details: "From Rodrigo\n  > could you review it?",
  at: "2026-10-08T13:50:27+02:00", links: ["https://github.com/acme/widgets/pull/42"], fields: { channel: "G01REVIEWS", kind: "mention" }, ...extra,
});

test("a report reads as the events it lists, each id once; an empty one is only a check-in", () => {
  const report = parseListenerReport(json({
    events: [
      ping({ summary: `  a summary\nthat runs  ${"on ".repeat(80)}`, details: `${"x".repeat(BOT_TRIGGER_LIMITS.slackDetails + 50)}`, links: ["https://www.github.com/acme/widgets/pull/42/files", "https://example.com/doc", "https://github.com/acme/widgets/pull/42", "https://github.com/a/b/pull/1", "https://github.com/a/b/pull/2", "https://github.com/a/b/pull/3"] }),
      ping({ summary: "the same id again, later in the report" }),
      { id: "jira:ACME-7", summary: "ACME-7 assigned to you", bot: true, external: false },
    ],
    error: "  the Slack MCP sign-in\nexpires soon ",
    catchUp: true,
  }), NOW);
  assert.deepEqual(report.events.map((event) => event.id), ["G01REVIEWS:1791481674.389319", "jira:ACME-7"]);
  const [first, second] = report.events as [ListenerEvent, ListenerEvent];
  assert.match(first.summary, /^a summary that runs on on/u);
  assert.equal(first.summary.length, 160, "one line, cut");
  assert.equal(first.details.length, BOT_TRIGGER_LIMITS.slackDetails);
  assert.match(first.details, /\n…$/u);
  assert.equal(first.at, "2026-10-08T11:50:27.000Z", "any ISO time, kept in UTC");
  assert.deepEqual(first.links, ["https://github.com/acme/widgets/pull/42", "https://github.com/a/b/pull/1", "https://github.com/a/b/pull/2"], "its pull requests, canonical, once each, three at most");
  assert.deepEqual(first.fields, { channel: "G01REVIEWS", kind: "mention" });
  assert.deepEqual([second.at, second.details, second.links, second.fields, second.bot, second.external], [new Date(NOW).toISOString(), "", [], {}, true, false], "when HUI got it, with nothing more");
  assert.deepEqual([report.error, report.catchUp], ["the Slack MCP sign-in expires soon", true]);
  assert.deepEqual(parseListenerReport(json({ events: [] }), NOW), { events: [], catchUp: false });
  // What a listener relays never brings a terminal's escapes or bidirectional overrides along.
  const [plain] = parseListenerReport(json({ events: [ping({ summary: "\u001b[31mred\u001b[0m alert \u202egnp.exe", details: "line one\n\tindented\u0007\u001b[2J\u2066done" })], error: "bad\u001b]0;title\u0007 news" }), NOW).events as [ListenerEvent];
  assert.equal(plain.summary, "[31mred [0m alert gnp.exe");
  assert.equal(plain.details, "line one\n\tindented[2Jdone");
  assert.equal(parseListenerReport(json({ events: [], error: "bad\u001b]0;title\u0007 news" }), NOW).error, "bad ]0;title news");
});

test("a report HUI can't read is refused with what to fix", () => {
  const event = ping();
  for (const [body, message] of [
    [{ kind: "text", value: "hello", bytes: 5, type: "text/plain" } as HookBody, /A listener reports JSON \(Content-Type: application\/json\)/u],
    [json([event]), /A listener reports JSON/u],
    [json({ events: [], extra: 1 }), /Unknown report field: extra\./u],
    [json({}), /events must be a list of at most 50 events, empty when nothing happened/u],
    [json({ events: Array.from({ length: 51 }, (_, index) => ({ ...event, id: `e${index}` })) }), /send more in several reports/u],
    [json({ events: ["ping"] }), /events\[0\] must be an object/u],
    [json({ events: [{ ...event, colour: "red" }] }), /Unknown events\[0\] field: colour\./u],
    [json({ events: [{ ...event, id: "" }] }), /events\[0\]\.id must be 1-200 characters on one line/u],
    [json({ events: [{ ...event, id: "x".repeat(201) }] }), /events\[0\]\.id must be/u],
    [json({ events: [{ ...event, id: "two\nlines" }] }), /events\[0\]\.id must be/u],
    [json({ events: [{ ...event, summary: "  " }] }), /events\[0\]\.summary must be text/u],
    [json({ events: [{ ...event, details: 7 }] }), /events\[0\]\.details must be text/u],
    [json({ events: [{ ...event, at: "yesterday-ish" }] }), /events\[0\]\.at must be an ISO 8601 time/u],
    [json({ events: [{ ...event, links: "https://github.com/a/b/pull/1" }] }), /events\[0\]\.links must be a list of at most 20 URLs/u],
    [json({ events: [{ ...event, fields: { "a.b": 1 } }] }), /events\[0\]\.fields\.a\.b must be text/u],
    [json({ events: [{ ...event, fields: { nested: { deep: true } } }] }), /events\[0\]\.fields\.nested must be text/u],
    [json({ events: [{ ...event, fields: { long: "x".repeat(501) } }] }), /fields\.long must be text \(500 characters at most\)/u],
    [json({ events: [{ ...event, bot: "yes" }] }), /events\[0\]\.bot must be true or false/u],
    [json({ events: [], error: { code: 1 } }), /error must be text/u],
    [json({ events: [], catchUp: "yes" }), /catchUp must be true or false/u],
  ] as const) {
    assert.throws(() => parseListenerReport(body, NOW), (error: unknown) => error instanceof TriggerInputError && message.test(error.message), message.source);
  }
});

test("a listener filter: nothing older than the trigger, bots and outsiders only when allowed, PR links, and a match on the event", () => {
  const [event] = parseListenerReport(json({ events: [ping()] }), NOW).events as [ListenerEvent];
  const since = "2026-10-08T11:00:00.000Z";
  assert.equal(listenerMatches({}, event, since), true);
  assert.equal(listenerMatches({}, event, "2026-10-08T12:00:00.000Z"), false, "an event from before the trigger");
  assert.equal(listenerMatches({}, { ...event, bot: true }, since), false);
  assert.equal(listenerMatches({ bots: true }, { ...event, bot: true }, since), true);
  assert.equal(listenerMatches({}, { ...event, external: true }, since), false);
  assert.equal(listenerMatches({ external: true }, { ...event, external: true }, since), true);
  assert.equal(listenerMatches({ prLinks: true }, { ...event, links: [] }, since), false);
  assert.equal(listenerMatches({ prLinks: true }, event, since), true);
  assert.equal(listenerMatches({ match: { field: "fields.channel", op: "equals", value: "G01REVIEWS" } }, event, since), true);
  assert.equal(listenerMatches({ match: { field: "fields.channel", op: "equals", value: "C0RANDOM" } }, event, since), false);
  assert.equal(listenerMatches({ match: { field: "summary", op: "contains", value: "widgets#42" } }, event, since), true);
  assert.equal(listenerMatches({ match: { field: "", op: "contains", value: "could you review" } }, event, since), true, "the whole event");
  assert.equal(listenerMatches({ match: { field: "fields.missing", op: "equals", value: "x" } }, event, since), false);
});
