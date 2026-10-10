import assert from "node:assert/strict";
import test from "node:test";
import type { SlackConnection } from "../shared/slack.ts";
import { triggerBody } from "./bot-triggers.ts";
import { HELP, parseCli } from "./main.ts";
import { formatSlackConnection } from "./slack.ts";

test("hui bot trigger add --slack: mentions and DMs, PR links only, people and channels, and who else may wake it", () => {
  const parsed = parseCli(["bot", "trigger", "add", "ada", "--name", "Reviews", "--slack", "--on", "mention,dm", "--pr-links", "--from", "maria, @bob", "--in", "#team-reviews,C0123ABCD", "--allow-external", "--allow-bots", "--prompt", "Review it.", "--cooldown", "1m"]);
  assert.deepEqual([parsed.command, parsed.operands], ["bot trigger add", ["ada"]]);
  assert.deepEqual(triggerBody(parsed.values), {
    name: "Reviews", prompt: "Review it.", cooldownSeconds: 60, source: "slack",
    filter: { events: ["mention", "dm"], prLinks: true, from: ["maria", "bob"], in: ["team-reviews", "C0123ABCD"], external: true, bots: true },
  });
  assert.deepEqual(triggerBody(parseCli(["bot", "trigger", "add", "ada", "--name", "DMs", "--slack", "--on", "dm"]).values), { name: "DMs", source: "slack", filter: { events: ["dm"] } });
  for (const [args, message] of [
    [["bot", "trigger", "add", "ada", "--name", "x", "--slack"], /--on takes Slack events, comma-separated: mention, dm/u],
    [["bot", "trigger", "add", "ada", "--name", "x", "--slack", "--on", "reaction"], /--on takes Slack events/u],
    [["bot", "trigger", "add", "ada", "--name", "x", "--slack", "--github", "a/b", "--on", "mention"], /exactly one of/u],
    [["bot", "trigger", "add", "ada", "--name", "x", "--session", "--on", "finished", "--pr-links"], /--pr-links only applies to --slack/u],
    [["bot", "trigger", "add", "ada", "--name", "x", "--github", "a/b", "--on", "pr_opened", "--in", "general"], /--in only applies to --slack/u],
    [["bot", "trigger", "add", "ada", "--name", "x", "--slack", "--on", "mention", "--from", " , "], /--from needs comma-separated names/u],
    [["bot", "trigger", "add", "ada", "--name", "x", "--slack", "--on", "mention", "--author", "bob"], /--author only applies to --github/u],
  ] as const) {
    assert.throws(() => parseCli([...args]), message, args.join(" "));
  }
});

test("hui slack connect, status and disconnect; a token is never an argument", () => {
  assert.equal(parseCli(["slack", "connect"]).command, "slack connect");
  assert.equal(parseCli(["slack", "status", "--json"]).command, "slack status");
  assert.equal(parseCli(["slack"]).command, "slack status");
  assert.equal(parseCli(["slack", "disconnect"]).command, "slack disconnect");
  assert.throws(() => parseCli(["slack", "connect", "xoxp-1111-2222-3333-abcdefabcdef"]), /takes no token on the command line: paste it at the prompt, or pipe it on stdin/u);
  assert.throws(() => parseCli(["slack", "connect", "--token", "xoxp-1111-2222-3333-abcdefabcdef"]), (error: unknown) => error instanceof Error && !error.message.includes("xoxp-1111"));
  assert.throws(() => parseCli(["slack", "status", "--name", "x"]), /--name is not valid for slack status/u);
  assert.throws(() => parseCli(["slack", "rotate"]), /Unknown command/u);
  for (const line of ["hui slack connect [--json]", "hui slack status [--json]", "hui slack disconnect [--json]", "| --webhook [--match <field=value|field~value>] | --slack --on <mention,dm> [--pr-links]"]) assert.ok(HELP.includes(line), line);
  assert.match(HELP, /connect asks for it at a hidden prompt, or reads it from stdin; it is never an\nargument\./u);
});

test("hui slack status says who, which workspace, whether Slack still accepts the token, and whether triggers read", () => {
  const now = Date.parse("2026-10-08T10:00:00Z");
  const base: SlackConnection = {
    configured: true, status: "connected", message: "Connected as dani in Acme.", user: "dani", userId: "U0OPERATOR", team: "Acme", teamId: "T0ACME",
    url: "https://acme.slack.com/", checkedAt: "2026-10-08T09:58:00Z", watch: { active: true, polledAt: "2026-10-08T09:59:30Z" },
  };
  assert.equal(formatSlackConnection(base, now), [
    "Slack: Connected as dani in Acme.",
    "Workspace: Acme (acme.slack.com) · as @dani · checked 2 min ago",
    "Slack triggers: read just now",
  ].join("\n"));
  assert.match(formatSlackConnection({ ...base, status: "revoked", message: "Token revoked or expired: connect again.", watch: { active: true, error: "Slack refused the token" } }, now), /^Slack: Token revoked or expired: connect again\.\n[\s\S]*Slack triggers: Slack refused the token$/u);
  assert.match(formatSlackConnection({ ...base, missingScopes: ["users:read"], watch: { active: false } }, now), /Missing scopes: users:read\nSlack triggers: not reading \(no enabled Slack trigger, or bots are off\)$/u);
  assert.equal(formatSlackConnection({ configured: false, status: "not_connected", message: "Not connected.", watch: { active: false } }), "Slack: not connected. Connect it with hui slack connect (or in Settings → Integrations → Slack).");
});
