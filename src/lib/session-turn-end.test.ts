import assert from "node:assert/strict";
import { test } from "node:test";
import { announceTurnEnd, onTurnEnd } from "./session-turn-end.ts";

test("only the named conversation's listeners hear its turn end", () => {
  const target = new EventTarget();
  const heard: string[] = [];
  const stopA = onTurnEnd("a", () => heard.push("a"), target);
  onTurnEnd("b", () => heard.push("b"), target);
  announceTurnEnd("a", target);
  announceTurnEnd("b", target);
  stopA();
  announceTurnEnd("a", target);
  assert.deepEqual(heard, ["a", "b"]);
});
