/**
 * `cli/browser.ts` against a stand-in gateway: the import command sends the operator's path exactly as typed, reads
 * nothing itself, and prints only what the gateway answered — its message, or its report with --json.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { test, type TestContext } from "vitest";
import { cookieImportReport } from "../server/browser/cookie-import.ts";
import type { StoredCookie } from "../server/browser/state.ts";
import { BROWSER_IMPORT_NEEDS_FILE } from "./commands.ts";
import { GatewayError } from "./gateway-client.ts";
import { browserImportCommand } from "./browser.ts";

type Call = { method: string; path: string; headers: Record<string, string | string[] | undefined>; body?: Record<string, unknown> };

/** A stand-in gateway: it records the one request the command makes and answers what the test told it to. */
async function fakeGateway(t: TestContext) {
  const calls: Call[] = [];
  let answer: { status: number; body: unknown } = { status: 500, body: { error: "no answer was set" } };
  const server = createServer(async (request, response) => {
    let text = "";
    for await (const chunk of request) text += chunk;
    calls.push({ method: request.method!, path: request.url!, headers: request.headers, ...(text ? { body: JSON.parse(text) as Record<string, unknown> } : {}) });
    const send = (status: number, body: unknown) => { response.writeHead(status, { "content-type": "application/json" }); response.end(JSON.stringify(body)); };
    // As the gateway's dispatch does, the request must carry the CLI's guard header.
    if (request.headers["x-hui"] !== "1") return send(403, { error: "missing x-hui header" });
    send(answer.status, answer.body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.onTestFinished(() => {
    server.closeAllConnections();
    return new Promise<void>((resolve) => server.close(() => resolve()));
  });
  return {
    base: `http://127.0.0.1:${(server.address() as { port: number }).port}/`,
    calls,
    answer: (status: number, body: unknown) => { answer = { status, body }; },
  };
}

/**
 * The command as `cli/main.ts` runs it: `io.out` is the process's stdout, and anything written outside it, or on
 * stderr, is recorded apart so a test can see the command added nothing of its own. A refusal is thrown, not printed:
 * `bin/hui.mjs` is what prints one, as `hui: <message>` with exit code 1.
 */
async function runImport(base: string, operands: readonly string[], flags: { json?: boolean } = {}) {
  let stdout = "";
  let stderr = "";
  let code: number | undefined;
  let error: unknown;
  const realOut = process.stdout.write;
  const realErr = process.stderr.write;
  process.stdout.write = ((chunk: string | Uint8Array) => { stdout += String(chunk); return true; }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array) => { stderr += String(chunk); return true; }) as typeof process.stderr.write;
  try {
    code = await browserImportCommand(base, operands, flags, { out: (text) => { process.stdout.write(text); } });
  } catch (thrown) {
    error = thrown;
  } finally {
    process.stdout.write = realOut;
    process.stderr.write = realErr;
  }
  return { code, stdout, stderr, error };
}

const STATE_FILE = "/home/me/exports/storage-state.json";
const REPORT = {
  imported: 2, expired: 1, domains: ["example.com", "mail.example.com"], applied: "now" as const,
  message: "imported 2 cookies for 2 domains (1 expired dropped)\ndomains: example.com, mail.example.com",
};

test("an import posts the path exactly as typed and prints the gateway's message alone", async (t) => {
  const gateway = await fakeGateway(t);
  gateway.answer(200, REPORT);
  const run = await runImport(gateway.base, [STATE_FILE]);
  assert.equal(run.code, 0);
  assert.deepEqual(gateway.calls.map(({ method, path, body }) => ({ method, path, body })), [{ method: "POST", path: "/__hui/browser/cookies", body: { path: STATE_FILE } }]);
  assert.equal(run.stdout, `${REPORT.message}\n`, "the gateway's own sentence, one newline, nothing else");
  assert.equal(run.stderr, "");
});

test("a relative path and `-` go to the gateway unchanged: judging a path is the route's job", async (t) => {
  const gateway = await fakeGateway(t);
  const refusal = "Give an absolute path to the cookie file.";
  for (const path of ["cookies.json", "-", "./exports/state.json", "~/hui/state.json"]) {
    gateway.answer(400, { error: refusal });
    const run = await runImport(gateway.base, [path]);
    assert.deepEqual(gateway.calls.at(-1)?.body, { path }, path);
    assert.equal(run.stdout, "", `${path}: a refusal prints nothing on stdout`);
    assert.equal(run.stderr, "", `${path}: the command prints no error itself`);
    assert.equal(run.code, undefined, `${path}: the bin sets the exit code from the throw`);
    assert.ok(run.error instanceof GatewayError, path);
    assert.equal(run.error.message, refusal, path);
    assert.equal(run.error.status, 400, path);
  }
});

test("--json prints the response object and nothing else", async (t) => {
  const gateway = await fakeGateway(t);
  gateway.answer(200, REPORT);
  const run = await runImport(gateway.base, [STATE_FILE], { json: true });
  assert.equal(run.code, 0);
  assert.equal(run.stdout, `${JSON.stringify(REPORT)}\n`);
  assert.deepEqual(JSON.parse(run.stdout), REPORT, "one line of JSON, the report as the gateway sent it");
  assert.equal(run.stderr, "");
});

test("a refused import throws the gateway's sentence with its status", async (t) => {
  const gateway = await fakeGateway(t);
  const refusal = "That is not a cookie export. Use a Playwright storageState file or a list of cookies.";
  gateway.answer(400, { error: refusal });
  const run = await runImport(gateway.base, ["/home/me/notes.json"]);
  assert.ok(run.error instanceof GatewayError);
  assert.equal(run.error.message, refusal);
  assert.equal(run.error.status, 400);
  assert.equal(run.stdout, "", "a refusal is the bin wrapper's to print, not the command's");
  assert.equal(run.stderr, "");
});

test("a cookie's value cannot reach the terminal: the CLI sends a path and prints the gateway's counts and domains", async (t) => {
  const gateway = await fakeGateway(t);
  // The stand-in is the only thing holding a cookie: its value never leaves it, and the report it builds is the one
  // the route builds, from `cookieImportReport`, which only ever counts entries and names domains.
  const value = `value-${randomUUID()}`;
  const domain = `${randomUUID()}.example`;
  const cookie: StoredCookie = { name: "session", value, domain, path: "/", at: 0 };
  const report = { imported: 1, expired: 0, domains: [domain], applied: "now" as const, message: cookieImportReport({ cookies: [cookie], expired: 0 }) };
  gateway.answer(200, report);
  // The path's file name carries a sentinel too, so what the CLI was given is known exactly.
  const file = `/home/me/${randomUUID()}.json`;
  const run = await runImport(gateway.base, [file]);
  assert.deepEqual(gateway.calls.at(-1)?.body, { path: file });
  assert.equal(run.stdout, `${report.message}\n`);
  assert.ok(run.stdout.includes(domain), "the gateway's message names the domain");
  assert.ok(!run.stdout.includes(value), "the value stayed in the stand-in");
  assert.ok(!run.stderr.includes(value));
  assert.equal(run.stderr, "");
});

test("an absolute path that does not exist still arrives: the CLI reads no file", async (t) => {
  const gateway = await fakeGateway(t);
  const missing = `/home/me/${randomUUID()}/missing.json`;
  assert.equal(existsSync(missing), false);
  gateway.answer(400, { error: "No readable file at that path." });
  const run = await runImport(gateway.base, [missing]);
  assert.deepEqual(gateway.calls.map((call) => call.body), [{ path: missing }], "the gateway refuses it, the CLI does not");
  assert.ok(run.error instanceof GatewayError);
  assert.equal(run.error.message, "No readable file at that path.");
  assert.equal(run.error.status, 400);
});

test("a wrong operand count names the usage before any request", async (t) => {
  const gateway = await fakeGateway(t);
  for (const operands of [[], ["a.json", "b.json"]]) {
    const run = await runImport(gateway.base, operands);
    assert.ok(run.error instanceof Error, operands.join(" "));
    assert.equal(run.error.message, BROWSER_IMPORT_NEEDS_FILE, operands.join(" "));
    assert.equal(run.stdout, "");
  }
  assert.deepEqual(gateway.calls, [], "nothing was asked of the gateway");
});
