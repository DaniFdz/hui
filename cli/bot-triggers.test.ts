import assert from "node:assert/strict";
import test from "node:test";
import type { BotTriggersList } from "../shared/bot-triggers.ts";
import { checkTriggerAdd, formatTriggers, parseCooldown, parseMatch, triggerBody } from "./bot-triggers.ts";
import { HELP, parseCli } from "./main.ts";

test("hui bot trigger parses list, add, remove and test with their operands and only their own flags", () => {
  assert.equal(parseCli(["bot", "trigger", "list", "ada"]).command, "bot trigger list");
  assert.equal(parseCli(["bots", "triggers", "list", "ada", "--json"]).command, "bot trigger list");
  const github = parseCli(["bot", "trigger", "add", "ada", "--name", "CI", "--github", "acme/widgets,acme/gadgets", "--on", "checks_failed,mention", "--author", "dependabot[bot]", "--label", "ci", "--base", "main", "--pr", "#12,14", "--ready", "--prompt", "Look.", "--cooldown", "10m"]);
  assert.deepEqual([github.command, github.operands], ["bot trigger add", ["ada"]]);
  assert.deepEqual(triggerBody(github.values), {
    name: "CI", prompt: "Look.", cooldownSeconds: 600, source: "github",
    filter: { repos: ["acme/widgets", "acme/gadgets"], events: ["checks_failed", "mention"], authors: ["dependabot[bot]"], labels: ["ci"], base: ["main"], pullRequests: [12, 14], draft: false },
  });
  assert.deepEqual(triggerBody(parseCli(["bot", "trigger", "add", "ada", "--name", "Kids", "--session", "--on", "finished,waiting"]).values), { name: "Kids", source: "session", filter: { events: ["finished", "waiting"] } });
  assert.deepEqual(triggerBody(parseCli(["bot", "trigger", "add", "ada", "--name", "Deploys", "--webhook", "--match", "deploy.status=failed", "--cooldown", "0"]).values),
    { name: "Deploys", cooldownSeconds: 0, source: "webhook", filter: { match: { field: "deploy.status", op: "equals", value: "failed" } } });
  assert.deepEqual(parseCli(["bot", "trigger", "remove", "ada", "CI", "--json"]).operands, ["ada", "CI"]);
  assert.deepEqual(parseCli(["bot", "trigger", "test", "ada", "CI"]).operands, ["ada", "CI"]);
  for (const [args, message] of [
    [["bot", "trigger", "add", "ada", "--github", "a/b", "--on", "pr_opened"], /needs --name/u],
    [["bot", "trigger", "add", "ada", "--name", "x"], /exactly one of --github <owner\/name,…>, --session or --webhook/u],
    [["bot", "trigger", "add", "ada", "--name", "x", "--session", "--webhook"], /exactly one/u],
    [["bot", "trigger", "add", "ada", "--name", "x", "--github", "a/b"], /--on takes GitHub events/u],
    [["bot", "trigger", "add", "ada", "--name", "x", "--github", "a/b", "--on", "pr_teleported"], /--on takes GitHub events/u],
    [["bot", "trigger", "add", "ada", "--name", "x", "--session", "--on", "pr_opened"], /--on takes session events/u],
    [["bot", "trigger", "add", "ada", "--name", "x", "--session", "--on", "finished", "--label", "ci"], /--label only applies to --github/u],
    [["bot", "trigger", "add", "ada", "--name", "x", "--webhook", "--on", "finished"], /--on doesn't apply to --webhook/u],
    [["bot", "trigger", "add", "ada", "--name", "x", "--session", "--on", "finished", "--match", "a=b"], /--match only applies to --webhook/u],
    [["bot", "trigger", "add", "ada", "--name", "x", "--webhook", "--match", "nothing"], /field=value/u],
    [["bot", "trigger", "add", "ada", "--name", "x", "--github", "a/b", "--on", "pr_opened", "--draft", "--ready"], /either --draft/u],
    [["bot", "trigger", "add", "ada", "--name", "x", "--github", "a/b", "--on", "pr_opened", "--cooldown", "soon"], /--cooldown takes 0 or a duration/u],
    [["bot", "trigger", "add", "ada", "--name", "x", "--github", "a/b", "--on", "pr_opened", "--pr", "twelve"], /--pr takes pull request numbers/u],
    [["bot", "trigger", "remove", "ada"], /needs <bot> <trigger>/u],
    [["bot", "trigger", "test", "ada", "CI", "--github", "a/b"], /--github is not valid for bot trigger test/u],
    [["bot", "trigger", "pause", "ada"], /Unknown command/u],
  ] as const) {
    assert.throws(() => parseCli([...args]), message, args.join(" "));
  }
});

test("cooldowns and matches read as the help says", () => {
  assert.equal(parseCooldown("0"), 0);
  assert.equal(parseCooldown("45"), 45);
  assert.equal(parseCooldown("45s"), 45);
  assert.equal(parseCooldown("5m"), 300);
  assert.equal(parseCooldown("2h"), 7_200);
  assert.equal(parseCooldown("1d"), 86_400);
  assert.deepEqual(parseMatch("action~open"), { field: "action", op: "contains", value: "open" });
  assert.deepEqual(parseMatch("=ping"), { field: "", op: "equals", value: "ping" });
  assert.deepEqual(parseMatch("url=https://x.test/?a=b"), { field: "url", op: "equals", value: "https://x.test/?a=b" }, "the first = splits");
  assert.doesNotThrow(() => checkTriggerAdd({ name: "x", webhook: true }));
});

test("the list says what each trigger watches, how it stands, and the hour's deliveries", () => {
  const empty: BotTriggersList = { triggers: [], runs: [], deliveries: { lastHour: 0, perHour: 12 } };
  assert.match(formatTriggers({ handle: "ada" }, empty), /@ada has no triggers\. Add one with hui bot trigger add ada/u);
  const list: BotTriggersList = {
    triggers: [{
      id: "3f2a1b2c-0000", botId: "id-ada", name: "CI", source: "github", filter: { repos: ["acme/widgets"], events: ["checks_failed"] }, enabled: true, cooldownSeconds: 300,
      createdBy: "operator", createdAt: "", updatedAt: "", lastFiredAt: "2026-10-07T10:00:00.000Z", pending: { events: 2, until: "2026-10-07T10:05:00.000Z" }, watch: { error: "gh is not signed in to GitHub" },
    }],
    runs: [],
    deliveries: { lastHour: 1, perHour: 12 },
  };
  assert.equal(formatTriggers({ handle: "ada" }, list), [
    "CI (3f2a1b2c) · GitHub · acme/widgets · Checks failed · cooldown 5 min · on · last fired 2026-10-07T10:00:00.000Z · 2 waiting until 2026-10-07T10:05:00.000Z · GitHub: gh is not signed in to GitHub",
    "Deliveries in the last hour: 1 of 12.",
  ].join("\n"));
});

test("HELP lists the trigger commands and what each source watches", () => {
  for (const line of [
    "hui bot trigger list <bot> [--json]",
    "hui bot trigger add <bot> --name <name> (--github <owner/name,…> --on <events> [--author <a,b>] [--label <a,b>]",
    "hui bot trigger remove <bot> <trigger> [--json]",
    "hui bot trigger test <bot> <trigger> [--json]",
  ]) assert.ok(HELP.includes(line), line);
  assert.match(HELP, /--session watches the\nsessions the bot itself starts; --webhook makes a URL, shown once/u);
});
