import assert from "node:assert/strict";
import { test } from "vitest";
import { bashHandoffRefusal, prHandoffRefusal } from "./pr-handoff.ts";

test("merging a pull request and marking one ready are refused, on their own or inside a compound command", () => {
  for (const command of [
    "gh pr merge 12 --squash --delete-branch",
    "cd repo && gh pr merge",
    "gh pr ready 12",
    "gh api repos/owner/repo/pulls/12/merge -X PUT",
  ]) {
    assert.match(prHandoffRefusal(command) ?? "", /HUI refused this/u, command);
  }
});

test("pushing to the default branch is refused in every spelling, and only that branch", () => {
  for (const command of [
    "git push origin main",
    "git push -u origin master",
    "git push origin HEAD:main",
    "git push origin +main",
    "git push --force-with-lease=main:abc origin main",
  ]) {
    assert.match(prHandoffRefusal(command) ?? "", /default branch/u, command);
  }
});

test("a feature branch, a read, and an ordinary command pass", () => {
  for (const command of [
    "git push -u origin dani.fernandez/composer-autonomy-toggle",
    "git push --force-with-lease origin feat/main-flag",
    "gh pr view 12 --json state",
    "gh pr create --draft --title 'x'",
    "git status",
    "",
  ]) {
    assert.equal(prHandoffRefusal(command), undefined, command);
  }
});

test("only a shell command in autonomous mode is checked", () => {
  assert.match(bashHandoffRefusal("bash", { command: "gh pr merge 3" }, true) ?? "", /HUI refused/u);
  assert.equal(bashHandoffRefusal("bash", { command: "gh pr merge 3" }, false), undefined);
  assert.equal(bashHandoffRefusal("read", { path: "gh pr merge 3" }, true), undefined);
  assert.equal(bashHandoffRefusal("bash", { command: 42 }, true), undefined);
});
