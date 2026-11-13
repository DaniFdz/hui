import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { nextTerminalTitle, terminalWorkViewKind } from "./terminal.ts";
import type { TerminalView } from "../../api/schema/terminals.ts";

test("a new terminal takes the first default name no tab of its conversation shows", () => {
  assert.equal(nextTerminalTitle([]), "Terminal 1");
  assert.equal(nextTerminalTitle(["Terminal 1"]), "Terminal 2");
  // A tab whose shell a gateway restart took away keeps its name on screen, so the next shell cannot take it.
  assert.equal(nextTerminalTitle(["Terminal 1", "Terminal"]), "Terminal 2");
  assert.equal(nextTerminalTitle(["Terminal 1", "Terminal 2"]), "Terminal 3");
  // Only a whole name counts: a shell someone renamed never blocks one, and a gap is filled.
  assert.equal(nextTerminalTitle(["Terminal 1 build", "Terminal 2"]), "Terminal 1");
});

const terminal = (id: string, title: string, status: TerminalView["status"] = "running"): TerminalView => ({
  id,
  ownerSessionId: "session-1",
  title,
  cwd: "/tmp",
  cols: 80,
  rows: 24,
  status,
  createdAt: "2026-09-28T10:00:00.000Z",
});

test("a tab a reload restored keeps the name its terminal carries, and the caption's listeners hear it", async () => {
  // A reload keeps each tab's ref and not the name the gateway gave the shell, so the tab captions read "Terminal" until
  // the conversation's terminals are listed again.
  vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ terminals: [terminal("a", "Terminal 2")] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  }));
  const kind = terminalWorkViewKind({ fontFamily: () => "monospace" });
  const ref = { kind: "terminal" as const, terminalId: "a" };
  assert.equal(kind.title(ref), "Terminal");

  let redrawn = 0;
  const stop = kind.onTitleChange!(() => { redrawn += 1; });
  assert.deepEqual(await kind.existing!("session-1"), [{ ref, title: "Terminal 2" }]);
  assert.equal(kind.title(ref), "Terminal 2");
  assert.equal(redrawn, 1, "the caption changed, so the tab and the destination chooser are told once");

  // Reading the same names again changes nothing, so nothing is redrawn twice.
  await kind.existing!("session-1");
  assert.equal(redrawn, 1);
  stop();
  vi.unstubAllGlobals();
});
