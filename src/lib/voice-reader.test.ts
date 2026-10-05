import assert from "node:assert/strict";
import { test } from "node:test";
import { ReadAloud, type ReadAloudState } from "./voice-reader.ts";

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void };
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((accept, refuse) => { resolve = accept; reject = refuse; });
  return { promise, resolve, reject };
}
const settle = async () => { for (let round = 0; round < 5; round++) await new Promise<void>((resolve) => setImmediate(resolve)); };

function reader(options: { fail?: (text: string) => boolean } = {}) {
  const states: ReadAloudState[] = [];
  const synthesized: string[] = [];
  const plays: { text: string; done: Deferred<void>; signal: AbortSignal }[] = [];
  const read = new ReadAloud({
    synthesize: async (text) => {
      synthesized.push(text);
      if (options.fail?.(text)) throw new Error("VoiceStudio failed (HTTP 500).");
      return new Blob([text]);
    },
    play: async (audio, signal) => {
      const done = deferred<void>();
      plays.push({ text: await audio.text(), done, signal });
      signal.addEventListener("abort", () => done.resolve());
      return done.promise;
    },
    onChange: (state) => states.push(state),
  });
  const finish = async () => {
    for (let guard = 0; guard < 20; guard++) {
      const open = plays.find((item) => !item.signal.aborted && !(item as { over?: boolean }).over);
      if (!open) return;
      (open as { over?: boolean }).over = true;
      open.done.resolve();
      await settle();
    }
  };
  return { read, states, synthesized, plays, finish };
}

test("reads a message chunk by chunk and ends idle", async () => {
  const { read, states, plays, finish } = reader();
  read.read("m1", "**Good morning.** Your first meeting is at ten, with Ana and the design team. Bring the draft.");
  assert.deepEqual(read.state, { id: "m1", status: "loading" });
  await settle();
  assert.deepEqual(read.state, { id: "m1", status: "playing" });
  await finish();
  assert.deepEqual(plays.map((item) => item.text), ["Good morning.", "Your first meeting is at ten, with Ana and the design team.", "Bring the draft."]);
  assert.deepEqual(states.map((state) => state.status), ["loading", "playing", "idle"]);
  assert.equal(read.played, true);
});

test("one reading at a time: reading another message or stopping cuts the current one", async () => {
  const { read, plays, states } = reader();
  read.read("m1", "First message. It is long enough to have two chunks for sure.");
  await settle();
  read.read("m2", "Second message.");
  await settle();
  assert.equal(plays[0]!.signal.aborted, true);
  assert.deepEqual(read.state, { id: "m2", status: "playing" });
  read.stop();
  assert.deepEqual(read.state, { id: "", status: "idle" });
  assert.equal(plays.at(-1)!.signal.aborted, true);
  assert.equal(states.at(-1)?.error, undefined, "a stop is not an error");
});

test("a message with nothing to say or a VoiceStudio failure explains itself", async () => {
  const empty = reader();
  empty.read.read("m1", "```\ncode only\n```");
  assert.deepEqual(empty.read.state, { id: "", status: "idle", error: "There is nothing to read aloud in that message." });
  const broken = reader({ fail: () => true });
  broken.read.read("m2", "Hello there.");
  await settle();
  assert.deepEqual(broken.read.state, { id: "", status: "idle", error: "VoiceStudio failed (HTTP 500)." });
  const partly = reader({ fail: (text) => text.startsWith("Second") });
  partly.read.read("m3", "First sentence here. Second sentence is long enough to be its own chunk.");
  await settle();
  await partly.finish();
  assert.equal(partly.read.state.error, "Part of the message could not be read aloud.");
});
