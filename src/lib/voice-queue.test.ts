import assert from "node:assert/strict";
import { test } from "node:test";
import { SpeechQueue, type SpeechQueueState } from "./voice-queue.ts";

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void };
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((accept, refuse) => { resolve = accept; reject = refuse; });
  return { promise, resolve, reject };
}
/** Lets settled promises run their continuations; no clock involved. */
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

/** A queue whose synthesis and playback the test finishes by hand. */
function harness(prefetch?: number) {
  const log: string[] = [];
  const syntheses = new Map<string, Deferred<Blob> & { signal: AbortSignal }>();
  const plays = new Map<string, Deferred<void> & { signal: AbortSignal }>();
  const texts = new Map<Blob, string>();
  const states: SpeechQueueState[] = [];
  const errors: string[] = [];
  const queue = new SpeechQueue({
    ...(prefetch === undefined ? {} : { prefetch }),
    synthesize: (text, signal) => {
      log.push(`synthesize ${text}`);
      const pending = deferred<Blob>();
      syntheses.set(text, { ...pending, signal });
      signal.addEventListener("abort", () => { log.push(`abort synthesis ${text}`); pending.reject(new DOMException("aborted", "AbortError")); });
      return pending.promise;
    },
    play: (audio, signal) => {
      const text = texts.get(audio)!;
      log.push(`play ${text}`);
      const pending = deferred<void>();
      plays.set(text, { ...pending, signal });
      signal.addEventListener("abort", () => { log.push(`stop ${text}`); pending.resolve(); });
      return pending.promise;
    },
    onState: (state) => states.push(state),
    onError: (_, text) => errors.push(text),
  });
  const audioFor = (text: string) => {
    const blob = new Blob([text], { type: "audio/mpeg" });
    texts.set(blob, text);
    syntheses.get(text)!.resolve(blob);
  };
  return { queue, log, syntheses, plays, states, errors, audioFor };
}

test("plays chunks in the order they were queued, whatever order their audio arrives in", async () => {
  const { queue, log, plays, audioFor } = harness();
  queue.enqueue("One.");
  queue.enqueue("Two.");
  queue.enqueue("Three.");
  assert.deepEqual(log, ["synthesize One.", "synthesize Two.", "synthesize Three."]);
  audioFor("Three.");
  audioFor("Two.");
  await settle();
  assert.deepEqual(log.filter((line) => line.startsWith("play")), [], "nothing plays before the first chunk's audio");
  audioFor("One.");
  await settle();
  plays.get("One.")!.resolve();
  await settle();
  plays.get("Two.")!.resolve();
  await settle();
  plays.get("Three.")!.resolve();
  await settle();
  assert.deepEqual(log.filter((line) => line.startsWith("play")), ["play One.", "play Two.", "play Three."]);
  assert.equal(queue.busy, false);
});

test("synthesizes ahead of the chunk playing, but no further than asked", async () => {
  const { queue, log, plays, audioFor } = harness(1);
  for (const text of ["A.", "B.", "C.", "D."]) queue.enqueue(text);
  assert.deepEqual(log, ["synthesize A.", "synthesize B."]);
  audioFor("A.");
  await settle();
  plays.get("A.")!.resolve();
  await settle();
  assert.deepEqual(log, ["synthesize A.", "synthesize B.", "play A.", "synthesize C."]);
});

test("stop aborts synthesis and playback, empties the queue and frees idle()", async () => {
  const { queue, log, plays, states, audioFor } = harness();
  queue.enqueue("Long answer.");
  queue.enqueue("More.");
  audioFor("Long answer.");
  await settle();
  assert.deepEqual(queue.state, { speaking: true, text: "Long answer.", pending: 1 });
  const idle = queue.idle();
  queue.stop();
  await idle;
  assert.equal(plays.get("Long answer.")!.signal.aborted, true);
  assert.ok(log.includes("stop Long answer.") && log.includes("abort synthesis More."));
  assert.deepEqual(queue.state, { speaking: false, pending: 0 });
  assert.equal(states.at(-1)?.speaking, false);
  await settle();
  assert.equal(log.filter((line) => line.startsWith("play")).length, 1, "nothing plays after a stop");
  // The queue is ready for the next reply.
  queue.enqueue("Next.");
  assert.equal(log.at(-1), "synthesize Next.");
});

test("a chunk that fails is reported and the next one plays", async () => {
  const { queue, log, syntheses, errors, audioFor } = harness();
  queue.enqueue("Broken.");
  queue.enqueue("Fine.");
  syntheses.get("Broken.")!.reject(new Error("VoiceStudio failed (HTTP 500)."));
  audioFor("Fine.");
  await settle();
  assert.deepEqual(errors, ["Broken."]);
  assert.equal(log.at(-1), "play Fine.");
});

test("idle() resolves once the last queued chunk has played", async () => {
  const { queue, plays, audioFor } = harness();
  let done = false;
  queue.enqueue("Only.");
  const idle = queue.idle().then(() => { done = true; });
  audioFor("Only.");
  await settle();
  assert.equal(done, false);
  plays.get("Only.")!.resolve();
  await idle;
  assert.equal(done, true);
  await queue.idle();
  queue.enqueue("   ");
  assert.equal(queue.busy, false, "blank text is not queued");
});
