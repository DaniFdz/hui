import assert from "node:assert/strict";
import test from "node:test";
import type { Peer } from "./protocol.ts";
import { RemoteChild } from "./remote-child.ts";

test("a connection lost before anyone listens ends the child without throwing", () => {
  const sent: unknown[] = [];
  let released = 0;
  const child = new RemoteChild({ send: (frame: unknown) => sent.push(frame) } as unknown as Peer, 1, () => { released += 1; });
  const exits: unknown[] = [];
  child.on("exit", (code, signal) => exits.push([code, signal]));
  assert.doesNotThrow(() => child.lost("Lost the connection."));
  assert.deepEqual(exits, [[null, null]]);
  assert.equal(released, 1);
  // Nothing more is sent for a channel that is gone.
  assert.equal(child.kill(), false);
  assert.equal(child.send({ type: "inspect" }), false);
  assert.deepEqual(sent, []);
});
