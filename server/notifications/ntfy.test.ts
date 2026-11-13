import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { afterEach, test } from "vitest";
import { ntfyConfigured, ntfyMessage, publishNtfy } from "./ntfy.ts";

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

/** A local relay that records what it was sent and answers with `status`. */
async function relay(status = 200): Promise<{ server: string; requests: { url?: string; headers: Record<string, string | string[] | undefined>; body: string }[] }> {
  const requests: { url?: string; headers: Record<string, string | string[] | undefined>; body: string }[] = [];
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => { body += String(chunk); });
    request.on("end", () => {
      requests.push({ url: request.url, headers: request.headers, body });
      response.writeHead(status).end(status === 200 ? "{}" : "no");
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return { server: `http://127.0.0.1:${address.port}`, requests };
}

test("a topic is the capability, and nothing malformed turns the relay on", () => {
  assert.equal(ntfyConfigured({ server: "https://ntfy.sh", topic: "hui-abc_123" }), true);
  for (const topic of ["", " ", "has space", "slash/name", "x".repeat(65), "émoji"]) {
    assert.equal(ntfyConfigured({ server: "https://ntfy.sh", topic }), false, JSON.stringify(topic));
  }
  assert.equal(ntfyConfigured(undefined), false);
});

test("a notification becomes the chat's title, its subtitle and message, and a tag for its kind", () => {
  assert.deepEqual(ntfyMessage({ title: "Fix the drawer", subtitle: "Needs your input", message: "Deploy to staging?", priority: "normal" }, "http://127.0.0.1:4175/sessions/a"), {
    title: "Fix the drawer",
    message: "Needs your input\nDeploy to staging?",
    priority: 3,
    tags: ["question"],
    click: "http://127.0.0.1:4175/sessions/a",
  });
  assert.deepEqual(ntfyMessage({ title: "Run", subtitle: "Run failed", priority: "low" }), {
    title: "Run", message: "Run failed", priority: 2, tags: ["x"],
  });
  assert.deepEqual(ntfyMessage({ title: "Finished", subtitle: "Finished", priority: "high" }), {
    title: "Finished", message: "Finished", priority: 4, tags: ["white_check_mark"],
  });
  assert.deepEqual(ntfyMessage({ title: "An agent", subtitle: "Tests", message: "Ready", priority: "normal" }), {
    title: "An agent", message: "Tests\nReady", priority: 3,
  }, "an unknown subtitle keeps no tag");
});

test("publishing posts the message as JSON to the topic, with the token from outside settings", async () => {
  const local = await relay();
  await publishNtfy({ server: `${local.server}/`, topic: "hui-abc" }, { title: "HUI", message: "Hello", priority: 3 }, { token: " secret-token " });
  assert.equal(local.requests.length, 1);
  const [request] = local.requests;
  assert.equal(request?.url, "/hui-abc", "a trailing slash on the server does not double");
  assert.equal(request?.headers["content-type"], "application/json");
  assert.equal(request?.headers["authorization"], "Bearer secret-token");
  assert.deepEqual(JSON.parse(request?.body ?? "{}"), { title: "HUI", message: "Hello", priority: 3 });

  await publishNtfy({ server: local.server, topic: "hui-abc" }, { title: "HUI", priority: 2 });
  assert.equal(local.requests[1]?.headers["authorization"], undefined, "no token, no header");
});

test("a refused or unreachable relay rejects without naming the topic", async () => {
  const refused = await relay(403);
  await assert.rejects(publishNtfy({ server: refused.server, topic: "hui-secret-topic" }, { title: "HUI", priority: 3 }), (error: Error) => {
    assert.match(error.message, /HTTP 403/u);
    assert.doesNotMatch(error.message, /hui-secret-topic/u, "the topic is a password and never appears in an error");
    return true;
  });

  const unreachable = await relay();
  const address = unreachable.server;
  const controller = new AbortController();
  const pending = publishNtfy({ server: address, topic: "hui-abc" }, { title: "HUI", priority: 3 }, { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending);

  await assert.rejects(publishNtfy({ server: "not a url", topic: "hui-abc" }, { title: "HUI", priority: 3 }), /valid http\(s\) address/u);
  await assert.rejects(publishNtfy({ server: "ftp://example.com", topic: "hui-abc" }, { title: "HUI", priority: 3 }), /valid http\(s\) address/u);
  await assert.rejects(publishNtfy({ server: "https://user:pass@example.com", topic: "hui-abc" }, { title: "HUI", priority: 3 }), /valid http\(s\) address/u);
});
