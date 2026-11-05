import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { ServerResponse } from "node:http";
import { test } from "vitest";

import { waitFor } from "../test-support/wait-for.ts";
import { MAX_STREAM_EVENTS, sendEventStream } from "./events.ts";

class FakeResponse extends EventEmitter {
  writableEnded = false;
  readonly chunks: string[] = [];
  writeHead() { return this; }
  flushHeaders() {}
  write(chunk: string) { this.chunks.push(chunk); return true; }
  end() { this.writableEnded = true; this.emit("finish"); }
}

const asResponse = (response: FakeResponse) => response as unknown as ServerResponse;
const body = (response: FakeResponse) => response.chunks.join("");

test("events become unnamed data frames in order", async () => {
  const response = new FakeResponse();
  sendEventStream(asResponse(response), (async function* () {
    yield { a: 1 };
    yield { b: "two" };
  })());
  await waitFor("the stream to end", () => response.writableEnded);
  assert.equal(body(response), 'data: {"a":1}\n\ndata: {"b":"two"}\n\n');
});

test("a heartbeat keeps an idle stream alive", async () => {
  const response = new FakeResponse();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  sendEventStream(asResponse(response), (async function* () {
    await gate;
    yield { done: true };
  })(), { heartbeatMs: 10 });
  await waitFor("a heartbeat comment", () => body(response).includes(": heartbeat\n\n"));
  release();
  await waitFor("the stream to end", () => response.writableEnded);
  assert.match(body(response), /data: \{"done":true\}/u);
});

test("a throw ends the stream with an error event and one report", async () => {
  const response = new FakeResponse();
  const errors: string[] = [];
  sendEventStream(asResponse(response), (async function* () {
    yield { ok: true };
    throw new Error("boom");
  })(), { onError: (message) => errors.push(message) });
  await waitFor("the stream to end", () => response.writableEnded);
  assert.match(body(response), /event: error\ndata: \{"error":"extension failed"\}\n\n/u);
  assert.deepEqual(errors, ["boom"]);
});

test("the caps end the stream with a named error", async () => {
  const tooMany = new FakeResponse();
  const manyErrors: string[] = [];
  sendEventStream(asResponse(tooMany), (async function* () {
    for (let index = 0; index <= MAX_STREAM_EVENTS; index += 1) yield { index };
  })(), { onError: (message) => manyErrors.push(message) });
  await waitFor("the event cap", () => tooMany.writableEnded);
  assert.deepEqual(manyErrors, ["too many events"]);
  assert.match(body(tooMany), /"error":"too many events"/u);

  const tooLarge = new FakeResponse();
  const largeErrors: string[] = [];
  sendEventStream(asResponse(tooLarge), (async function* () {
    yield { text: "x".repeat(256 * 1024) };
  })(), { onError: (message) => largeErrors.push(message) });
  await waitFor("the event size cap", () => tooLarge.writableEnded);
  assert.deepEqual(largeErrors, ["event too large"]);

  const tooMuch = new FakeResponse();
  const totalErrors: string[] = [];
  sendEventStream(asResponse(tooMuch), (async function* () {
    for (let index = 0; index < 21; index += 1) yield { text: "x".repeat(255 * 1024) };
  })(), { onError: (message) => totalErrors.push(message) });
  await waitFor("the total size cap", () => tooMuch.writableEnded);
  assert.deepEqual(totalErrors, ["stream too large"]);
});

test("a client that leaves stops the generator", async () => {
  const response = new FakeResponse();
  let returned = false;
  sendEventStream(asResponse(response), (async function* () {
    try {
      while (true) {
        yield { tick: true };
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    } finally {
      returned = true;
    }
  })(), { heartbeatMs: 1_000 });
  await waitFor("the first frame", () => response.chunks.length > 0);
  response.emit("close");
  await waitFor("the generator's return", () => returned, { timeoutMs: 2_000 });
  assert.equal(response.writableEnded, true, "the stream closes after the generator returns");
});
