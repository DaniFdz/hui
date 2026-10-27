import assert from "node:assert/strict";
import { test } from "vitest";

import { modelRoutesFrom, routeGuidelines } from "./hui-prompt.ts";

test("writes no route block when the operator configured none", () => {
  assert.equal(routeGuidelines([]), "");
});

test("gives the agent route names and descriptions and never a model id", () => {
  const text = routeGuidelines([
    { name: "fast", description: "Cheap and quick." },
    { name: "deep", description: "" },
  ]);
  assert.match(text, /pass `route` to choose one/u);
  assert.match(text, /^- fast: Cheap and quick\.$/mu);
  assert.match(text, /^- deep: no description$/mu);
});

test("reads the worker's route env and survives a malformed one", () => {
  assert.deepEqual(modelRoutesFrom(undefined), []);
  assert.deepEqual(modelRoutesFrom("not json"), []);
  assert.deepEqual(modelRoutesFrom(JSON.stringify([null, 3, "fast", {}])), []);
  assert.deepEqual(
    modelRoutesFrom(JSON.stringify([
      { name: " fast ", description: "Cheap.", model: "gateway/cheap" },
      { name: "deep" },
    ])),
    [{ name: "fast", description: "Cheap." }, { name: "deep", description: "" }],
  );
});
