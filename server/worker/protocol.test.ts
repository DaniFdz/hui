import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import test from "node:test";
import { attachPeer, LineSplitter } from "./protocol.ts";

function pair() {
  const ab = new PassThrough();
  const ba = new PassThrough();
  return { a: attachPeer(ba, ab), b: attachPeer(ab, ba), ba };
}

test("frames split on newlines only, across chunk boundaries", () => {
  const splitter = new LineSplitter();
  const value = JSON.stringify({ t: "out", d: "line\u2028separator\u2029paragraph" });
  assert.deepEqual(splitter.push(value.slice(0, 7)), []);
  assert.deepEqual(splitter.push(`${value.slice(7)}\r\n\n${value}\n`), [value, value]);
});

test("requests carry parameters named like protocol fields", async () => {
  const { a, b } = pair();
  b.handle("credential", (params) => params);
  // `op`, `id` and `t` are ordinary parameter names to the caller.
  assert.deepEqual(await a.request("credential", { op: "read", id: "x", t: "y" }), { op: "read", id: "x", t: "y" });
});

test("handler failures reject the caller and unknown requests are refused", async () => {
  const { a, b } = pair();
  b.handle("boom", () => { throw new Error("remote failure"); });
  await assert.rejects(a.request("boom"), /remote failure/u);
  await assert.rejects(a.request("missing"), /Unsupported remote worker request: missing/u);
});

test("losing the stream rejects pending and later requests", async () => {
  const { a, b, ba } = pair();
  b.handle("slow", () => new Promise(() => undefined));
  const pending = a.request("slow");
  ba.destroy();
  await assert.rejects(pending, /connection closed/u);
  await assert.rejects(a.request("slow"), /connection closed/u);
});

test("malformed input closes the peer instead of throwing", async () => {
  const input = new PassThrough();
  const peer = attachPeer(input, new PassThrough());
  const closed = new Promise<string>((resolve) => peer.onClose(resolve));
  input.write("not json\n");
  assert.match(await closed, /malformed/u);
});
