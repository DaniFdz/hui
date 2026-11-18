import assert from "node:assert/strict";
import { test } from "vitest";
import { composerFocusAfterSend } from "./composer-focus.ts";

test("a send started in the composer takes the caret back when the page's focus was left nowhere", () => {
  assert.equal(composerFocusAfterSend({ fromComposer: true, owner: "body" }), true);
});

test("a send started in the composer takes the caret back from the control that held it when the send started", () => {
  assert.equal(composerFocusAfterSend({ fromComposer: true, owner: "send-control" }), true);
});

test("a control the operator moved to while the send posted keeps the focus it was given", () => {
  assert.equal(composerFocusAfterSend({ fromComposer: true, owner: "elsewhere" }), false);
});

test("a send that did not start in the composer never moves the focus, wherever the page's focus is", () => {
  for (const owner of ["body", "send-control", "elsewhere"] as const) {
    assert.equal(composerFocusAfterSend({ fromComposer: false, owner }), false, owner);
  }
});
