import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { messageContextMenuPosition } from "./message-context-menu.ts";

test("message context actions clamp to the viewport, including short landscape", () => {
  assert.deepEqual(messageContextMenuPosition(250, 750, 160, 60, 390, 844), { left: 222, top: 750 });
  assert.deepEqual(messageContextMenuPosition(840, 380, 200, 110, 844, 390), { left: 636, top: 272 });
  assert.deepEqual(messageContextMenuPosition(-1, -5, 160, 60, 120, 40), { left: 0, top: 0 });
});

test("settled messages keep the context menu and a footer copy button", () => {
  const view = readFileSync(new URL("../views/home.ts", import.meta.url), "utf8");
  assert.match(view, /row\.role === "assistant" \? "Copy response" : "Copy prompt"/);
  assert.match(view, /@contextmenu=\$\{\(event: MouseEvent\) => openMessageContextMenu/);
  assert.match(view, /@keydown=\$\{\(event: KeyboardEvent\) => openMessageContextMenu/);
  assert.match(view, /chat-group-footer--persistent-identity/);
});
