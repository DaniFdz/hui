import assert from "node:assert/strict";
import { test } from "vitest";
import { CheckEvidence } from "./check-evidence.ts";
import { createsPullRequest, prCreateRefusal } from "./pr-handoff.ts";

test("a pull request waits for the declared command to pass after the last edit", () => {
  const evidence = new CheckEvidence();
  assert.match(prCreateRefusal(evidence.state()) ?? "", /no check command is declared/u);

  evidence.declare("npm test");
  assert.match(prCreateRefusal(evidence.state()) ?? "", /has not passed since your last change/u);

  evidence.edited();
  evidence.ran("ls", true, 2_000);
  assert.match(prCreateRefusal(evidence.state()) ?? "", /has not passed/u, "another command proves nothing");

  evidence.ran("npm test", false, 3_000);
  assert.match(prCreateRefusal(evidence.state()) ?? "", /has not passed/u, "a failed run proves nothing");

  evidence.ran("npm test", true, 4_000);
  assert.equal(prCreateRefusal(evidence.state()), undefined);

  evidence.edited();
  assert.match(prCreateRefusal(evidence.state()) ?? "", /has not passed/u, "a new edit throws the evidence away");
});

test("only a pull request creation is latched; the hand-off refusals stay separate", () => {
  assert.equal(createsPullRequest("gh pr create --draft --title x"), true);
  assert.equal(createsPullRequest("cd repo && gh pr create --fill"), true);
  assert.equal(createsPullRequest("gh pr view 3"), false);
  assert.equal(createsPullRequest("git push origin feat/x"), false);
});
