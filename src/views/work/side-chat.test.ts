import assert from "node:assert/strict";
import { test } from "vitest";
import { defaultWorkViewKey, parseWorkViewRef } from "../../lib/work-pane.ts";
import { sideChatWorkViewKind } from "./side-chat.ts";

test("a conversation has one Side chat view, named Side chat and listed by the pane", () => {
  const ref = { kind: "side-chat" as const };
  assert.equal(sideChatWorkViewKind.kind, "side-chat");
  assert.equal(sideChatWorkViewKind.label, "Side chat");
  assert.equal(sideChatWorkViewKind.single, true, "the pane lists the open view instead of its launcher");
  assert.deepEqual(sideChatWorkViewKind.create("session-a"), ref);
  assert.equal(sideChatWorkViewKind.key(ref), "side-chat");
  assert.equal(sideChatWorkViewKind.key(ref), defaultWorkViewKey(ref));
  assert.equal(sideChatWorkViewKind.title(ref), "Side chat");
  assert.equal(sideChatWorkViewKind.shortcut, undefined);
  assert.equal(sideChatWorkViewKind.hidden?.(), true, "/btw opens it; a launcher would only open a placeholder");
});

test("its icon carries its own 16px size, so the tab strip and the launcher can draw it", () => {
  assert.match(sideChatWorkViewKind.icon.strings.join(""), /width="16" height="16"/u);
});

test("a stored Side chat tab survives a reload", () => {
  assert.deepEqual(parseWorkViewRef({ kind: "side-chat" }, () => true), { kind: "side-chat" });
});
