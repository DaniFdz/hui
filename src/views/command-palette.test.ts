import assert from "node:assert/strict";
import { test } from "vitest";

import type { BotView } from "../lib/bots/bots.ts";
import { HUI_PAGES } from "../lib/pages.ts";
import type { SessionGroup } from "../api/sessions.ts";
import {
  commandPaletteItems,
  isCommandPaletteShortcut,
  nextCommandPaletteIndex,
} from "./command-palette.ts";

const groups: SessionGroup[] = [{
  label: "Frontend",
  sessions: [{
    id: "session-1",
    title: "Fix navigation",
    group: "Frontend",
    cwd: "/repo/web",
    tool: "pi",
    status: "idle",
    displayCwd: "",
    stage: "investigation",
    stageOrigin: "default",
    createdAt: "2026-09-23T00:00:00.000Z",
    updatedAt: "2026-09-23T00:00:00.000Z",
  }],
}];

test("the empty palette matches OpenClaw's compact navigation entry set", () => {
  assert.deepEqual(commandPaletteItems(HUI_PAGES, groups, "").map((item) => item.label), [
    "New Session",
    "Sessions",
    "Automations",
    "Plugins",
    "Settings",
  ]);
});

test("palette search reaches sessions, settings and pages", () => {
  assert.equal(commandPaletteItems(HUI_PAGES, groups, "fix nav")[0]?.label, "Fix navigation");
  assert.equal(commandPaletteItems(HUI_PAGES, groups, "privacy")[0]?.label, "Privacy & Security");
  assert.equal(commandPaletteItems(HUI_PAGES, groups, "activity")[0]?.label, "Activity");
  assert.equal(commandPaletteItems(HUI_PAGES, groups, "agents").some((item) => item.label === "Agents"), false);
});

test("palette actions rank above chats with the same words", () => {
  const settingsChat: SessionGroup[] = [{ label: "Frontend", sessions: [{ ...groups[0]!.sessions[0]!, id: "session-2", title: "Settings polish" }] }];
  const results = commandPaletteItems(HUI_PAGES, settingsChat, "settings");
  assert.equal(results[0]?.label, "Settings");
  assert.ok(results.findIndex((item) => item.category === "chats") > results.findLastIndex((item) => item.category === "settings"));
});

test("palette search finds bots by name and handle, never archived ones", () => {
  const bot = { id: "b1", handle: "moncho", name: "Moncho", title: "PR shepherd", archived: false } as BotView;
  const archived = { ...bot, id: "b2", handle: "old", name: "Old Moncho", archived: true } as BotView;
  assert.deepEqual(commandPaletteItems(HUI_PAGES, groups, "monch", [bot, archived]).map((item) => item.id), ["bot:b1"]);
  assert.equal(commandPaletteItems(HUI_PAGES, groups, "@moncho", [bot])[0]?.label, "Moncho");
});

test("palette keyboard navigation wraps in both directions", () => {
  assert.equal(nextCommandPaletteIndex(4, 5, "ArrowDown"), 0);
  assert.equal(nextCommandPaletteIndex(0, 5, "ArrowUp"), 4);
  assert.equal(nextCommandPaletteIndex(0, 0, "ArrowDown"), 0);
});

test("the command shortcut follows the platform modifier", () => {
  const event = { altKey: false, ctrlKey: false, defaultPrevented: false, isComposing: false, key: "k", metaKey: true };
  assert.equal(isCommandPaletteShortcut(event, true), true);
  assert.equal(isCommandPaletteShortcut(event, false), false);
  assert.equal(isCommandPaletteShortcut({ ...event, metaKey: false, ctrlKey: true }, false), true);
  assert.equal(isCommandPaletteShortcut({ ...event, altKey: true }, true), false);
});
