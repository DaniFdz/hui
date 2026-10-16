/** The automatic cleanup of a bot's export: what it changes before any model reads it, and what it leaves alone. */
import assert from "node:assert/strict";
import { test } from "vitest";
import { cleanText } from "./cleanup.ts";

const IDENTITY = { operator: "Dani Fernandez", home: "/Users/dani.fernandez", username: "dani.fernandez", hostname: "COMP-K7WX9J.local", workers: ["devbox", "dev"] };
const clean = (text: string) => cleanText(text, IDENTITY);

test("the operator's name, home folders, e-mail addresses, machine and worker names in paths, tailnet names, IPs, Slack IDs, keys and trigger links go", () => {
  const { text, hits } = clean([
    "I'm Dani's helper; Dani Fernandez works with ana@example.com.",
    "Run /Users/dani.fernandez/dd/x.sh, /home/bits/y or /Users/someone/z. Branches start with dani.fernandez/feature.",
    "ssh devbox:/srv, https://devbox.tail1234.ts.net/x, COMP-K7WX9J.local/share, 10.1.2.3, Slack C0123ABCD.",
    `token: ghp_${"a".repeat(36)}; API_KEY=abcdef1234567890abcd; Bearer abcdefghijklmnopqrstu; /__hui/hooks/AbC123_-x.`,
    "-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----",
  ].join("\n"));
  assert.equal(text, [
    "I'm {{user}}'s helper; {{user}} works with [removed].",
    "Run ~/dd/x.sh, ~/y or ~/z. Branches start with [removed]/feature.",
    "ssh [removed]:/srv, https://[removed]/x, [removed]/share, [removed], Slack [removed].",
    "token: [removed]; API_KEY=[removed]; Bearer [removed]; /__hui/hooks/[removed].",
    "[removed]",
  ].join("\n"));
  assert.deepEqual(hits.find((hit) => hit.kind === "a key or token"), { kind: "a key or token", sample: "ghp_…", count: 3 }, "a secret is never shown whole");
  assert.deepEqual(hits.find((hit) => hit.kind === "your name"), { kind: "your name", sample: "Dani Fernandez", count: 2 });
});

test("ordinary text stays: common words of a name, git's address, loopback, versions, generic machine names outside paths", () => {
  const text = "Will you approve? Mark it and ping the dev team. git clone git@github.com:acme/widgets.git; curl 127.0.0.1:8080; v1.2.3 and 1.2.3; Dani is gone? no: danish pastry.";
  const willMark = cleanText(text, { ...IDENTITY, operator: "Will Mark" });
  assert.equal(willMark.text, text, "a name made of common words is left to the reviewer");
  assert.equal(clean(text).text, text.replace("Dani is gone", "{{user}} is gone"));
  assert.deepEqual(cleanText("", IDENTITY), { text: "", hits: [] });
  const started = Date.now();
  cleanText(`${"a+b/".repeat(60_000)} ${"ab.".repeat(80_000)} ${"x".repeat(200_000)}@`, IDENTITY);
  assert.ok(Date.now() - started < 5_000, "long text without spaces stays fast");
});
