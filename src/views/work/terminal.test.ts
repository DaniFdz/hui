import assert from "node:assert/strict";
import { test } from "vitest";
import { nextTerminalTitle } from "./terminal.ts";

test("a new terminal takes the first default name no tab of its conversation shows", () => {
  assert.equal(nextTerminalTitle([]), "Terminal 1");
  assert.equal(nextTerminalTitle(["Terminal 1"]), "Terminal 2");
  // A tab whose shell a gateway restart took away keeps its name on screen, so the next shell cannot take it.
  assert.equal(nextTerminalTitle(["Terminal 1", "Terminal"]), "Terminal 2");
  assert.equal(nextTerminalTitle(["Terminal 1", "Terminal 2"]), "Terminal 3");
  // Only a whole name counts: a shell someone renamed never blocks one, and a gap is filled.
  assert.equal(nextTerminalTitle(["Terminal 1 build", "Terminal 2"]), "Terminal 1");
});
