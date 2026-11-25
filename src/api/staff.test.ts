import assert from "node:assert/strict";
import { test } from "vitest";
import { createStaffChief } from "./staff.ts";

const CHIEF = {
  id: "b1",
  handle: "chief-remote",
  name: "Chief of Staff · Remote",
  title: "Chief of Staff",
  cwd: "/home/me/.config/hui/bots/b1",
  sessionId: "s1",
  status: "idle",
  soul: true,
};

test("creating a group's chief sends only its group", async () => {
  const original = globalThis.fetch;
  const calls: { url: string; method: string; body: unknown; headers: Record<string, string> }[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    calls.push({ url: String(input), method: init.method ?? "GET", body: JSON.parse(String(init.body)), headers: init.headers as Record<string, string> });
    return new Response(JSON.stringify({ bot: CHIEF }), { status: 201, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    const bot = await createStaffChief({ group: "Remote" });
    assert.equal(bot.id, "b1");
    assert.deepEqual(calls.map(({ url, method, body }) => [url, method, body]), [["/__hui/staff/chiefs", "POST", { group: "Remote" }]]);
    assert.equal(calls[0]?.headers["content-type"], "application/json");
    assert.equal(calls[0]?.headers["x-hui"], "1");
  } finally {
    globalThis.fetch = original;
  }
});
