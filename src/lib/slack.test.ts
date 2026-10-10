import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseSlackConnection, slackHost, slackStatusLabel } from "./slack.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("the gateway's answer is narrowed to the connection view; a token-shaped field never reaches it", () => {
  const view = parseSlackConnection({
    configured: true, status: "connected", message: "Connected as dani in Acme.", user: "dani", userId: "U0OPERATOR", team: "Acme", teamId: "T0ACME",
    url: "https://acme.slack.com/", scopes: ["search:read", 7], checkedAt: "2026-10-08T09:00:00Z", watch: { active: true, polledAt: "2026-10-08T09:01:00Z" }, token: "xoxp-should-not-pass",
  });
  assert.deepEqual(view, {
    configured: true, status: "connected", message: "Connected as dani in Acme.", user: "dani", userId: "U0OPERATOR", team: "Acme", teamId: "T0ACME",
    url: "https://acme.slack.com/", scopes: ["search:read"], checkedAt: "2026-10-08T09:00:00Z", watch: { active: true, polledAt: "2026-10-08T09:01:00Z" },
  });
  assert.deepEqual(parseSlackConnection({ status: "teleported" }), { configured: false, status: "not_connected", message: "Not connected.", watch: { active: false } });
  assert.throws(() => parseSlackConnection("nope"), /did not come back/u);
  assert.equal(slackHost("https://acme.slack.com/"), "acme.slack.com");
  assert.equal(slackHost("not a url"), "");
});

test("the status pill names each state plainly", () => {
  const view = (status: string) => parseSlackConnection({ configured: status !== "not_connected", status });
  assert.deepEqual(slackStatusLabel(undefined), { kind: "muted", label: "Checking…" });
  assert.deepEqual(slackStatusLabel(view("connected")), { kind: "ok", label: "Connected" });
  assert.deepEqual(slackStatusLabel(view("revoked")), { kind: "danger", label: "Token revoked or expired" });
  assert.deepEqual(slackStatusLabel(view("missing_scopes")), { kind: "warn", label: "Missing scopes" });
  assert.deepEqual(slackStatusLabel(view("unverified")), { kind: "warn", label: "Could not verify" });
  assert.deepEqual(slackStatusLabel(view("not_connected")), { kind: "muted", label: "Not connected" });
});

test("Settings → Integrations shows Slack after GitHub: a masked, write-only token field, Connect, Disconnect and the manifest", () => {
  const settings = read("../views/settings.ts");
  assert.match(settings, /<hui-github-settings><\/hui-github-settings>\n\s+<hui-slack-settings><\/hui-slack-settings>/u);
  const section = read("../views/settings-slack.ts");
  assert.match(section, /<input class="input" name="token" type="password" required autocomplete="off" spellcheck="false" placeholder="xoxp-…" \/>/u);
  assert.match(section, /form\.reset\(\);/u, "the field is emptied once the gateway has it");
  assert.match(section, /Copy manifest/u);
  assert.match(section, /Many company workspaces need an admin to approve apps first/u);
  assert.match(section, /Disconnect/u);
  assert.match(section, /Token revoked or expired: connect again\./u);
  assert.doesNotMatch(section, /\.token\b/u, "the view never reads a token from the gateway");
});
