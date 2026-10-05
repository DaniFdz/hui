import assert from "node:assert/strict";
import { test } from "node:test";
import { endOf, label, nodeCount, PLACEHOLDER, startOf, Tree, type Part } from "./tree.ts";
import { View } from "./view.ts";

/** Every complete node over `count` messages, each text exactly 10 bytes. */
function fullTree(count: number): Tree {
  const tree = new Tree();
  for (let l = 0; 2 ** l <= count; l++) for (let i = 0; (i + 1) * 2 ** l <= count; i++) tree.set(l, i, `L${l}N${i}`.padEnd(10, "."));
  assert.equal(tree.count, nodeCount(count));
  return tree;
}

function folded(tree: Tree, budget: number) {
  const source = { length: 0, tree };
  const view = new View(source, budget);
  const append = () => { view.append(source.length++); return view.parts(); };
  return { source, view, append };
}

test("each message appends its part, then the most due pair with a built parent merges until the view fits", () => {
  const { view, append } = folded(fullTree(10), 40);
  const steps: Part[][] = [];
  for (let i = 0; i < 10; i++) steps.push(append());
  assert.deepEqual(steps, [
    [[0, 0]],
    [[0, 0], [0, 1]],
    [[0, 0], [0, 1], [0, 2]],
    [[0, 0], [0, 1], [0, 2], [0, 3]],
    // due = (T - start) / 2^(l+2): (5-0)/4 beats (5-2)/4.
    [[1, 0], [0, 2], [0, 3], [0, 4]],
    [[1, 0], [1, 1], [0, 4], [0, 5]],
    // The level-1 pair is older for its size, (7-0)/8 = 0.875, than the level-0 pair at 4, (7-4)/4 = 0.75.
    [[2, 0], [0, 4], [0, 5], [0, 6]],
    [[2, 0], [1, 2], [0, 6], [0, 7]],
    [[2, 0], [1, 2], [1, 3], [0, 8]],
    [[2, 0], [2, 1], [0, 8], [0, 9]],
  ]);
  assert.deepEqual([view.size, view.length], [40, 4]);
  // Never split: every part of an earlier step is still in the view or inside a part of it.
  for (let k = 1; k < steps.length; k++) {
    for (const part of steps[k - 1]!) {
      assert(steps[k]!.some((next) => startOf(next) <= startOf(part) && endOf(part) <= endOf(next)), `step ${k} split ${label(part)}`);
    }
  }
});

test("an over-budget view waits for parents to be built, then merges", () => {
  const tree = new Tree();
  for (let i = 0; i < 4; i++) tree.set(0, i, `L0N${i}`.padEnd(10, "."));
  const { view, append } = folded(tree, 20);
  for (let i = 0; i < 4; i++) append();
  assert.deepEqual([view.parts(), view.size], [[[0, 0], [0, 1], [0, 2], [0, 3]], 40], "no parent: nothing to merge");
  tree.set(1, 1, "L1N1".padEnd(10, "."));
  view.built(1, 1);
  assert.deepEqual(view.parts(), [[0, 0], [0, 1], [1, 1]], "the only mergeable pair, though it is the least due");
  tree.set(1, 0, "L1N0".padEnd(10, "."));
  view.built(1, 0);
  assert.deepEqual([view.parts(), view.size], [[[1, 0], [1, 1]], 20]);
});

test("an unsummarized message counts and renders as its placeholder; settle waits for it and aborts", async () => {
  const tree = new Tree();
  const { view, append } = folded(tree, 1_000);
  append(); append();
  assert.equal(view.size, 2 * Buffer.byteLength(PLACEHOLDER));
  assert.deepEqual([view.first(), view.settled(0), view.settled(1)], [0, true, false]);
  const waited = view.settle(1);
  const controller = new AbortController();
  const aborted = view.settle(2, controller.signal);
  assert.equal(view.waiting, 2);
  controller.abort();
  assert.equal(await aborted, false);
  assert.equal(view.waiting, 1);
  tree.set(0, 0, "user: hi\nthere");
  view.built(0, 0);
  assert.equal(await waited, true);
  assert.deepEqual([view.waiting, view.first(), view.size], [0, 1, Buffer.byteLength("user: hi\nthere") + Buffer.byteLength(PLACEHOLDER)]);
  assert.equal(view.render(), `<chat>\n0+1|user: hi there\n1+1|${PLACEHOLDER}\n</chat>`);
  assert.deepEqual(view.context(1), ["user: hi there"], "the compactor sees bare lines, no ids");
  assert.equal(await view.settle(1, AbortSignal.abort()), true, "already settled");
  const late = view.settle(2);
  view.close();
  assert.equal(await late, false, "closing releases waiters");
});

test("a frozen prefix tiles exactly the messages before its bound", () => {
  const { view, append } = folded(fullTree(4), 10);
  append(); append();
  assert.deepEqual(view.parts(), [[1, 0]]);
  assert.deepEqual(view.parts(1), [[0, 0]], "a part straddling the bound gives its children");
  assert.deepEqual(view.parts(2), [[1, 0]]);
  append(); append();
  assert.deepEqual(view.parts(), [[2, 0]]);
  assert.deepEqual(view.parts(3), [[1, 0], [0, 2]]);
  assert.equal(view.render(view.parts(3)), "<chat>\n0+2|L1N0......\n2+1|L0N2......\n</chat>");
  assert.equal(new View({ length: 0, tree: new Tree() }, 10).render(), "<chat>\n\n</chat>");
});
