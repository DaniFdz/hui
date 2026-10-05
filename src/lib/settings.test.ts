import assert from "node:assert/strict";
import { test } from "node:test";

import { DEFAULT_SETTINGS, normalizeBranchPrefix, normalizeSettings } from "./settings.ts";

test("round-trips a complete file", () => {
  assert.deepEqual(
    normalizeSettings({
      theme: "catppuccin",
      themeMode: "dark",
      fontUi: "geist",
      fontChat: "lora",
      textScale: 125,
    }),
    {
      ...DEFAULT_SETTINGS,
      theme: "catppuccin",
      themeMode: "dark",
      fontUi: "geist",
      fontChat: "lora",
      textScale: 125,
    },
  );
});

test("ignores the retired single typeface preference", () => {
  const settings = normalizeSettings({ typeface: "serif" });
  assert.equal(settings.fontUi, DEFAULT_SETTINGS.fontUi);
  assert.equal(settings.fontChat, DEFAULT_SETTINGS.fontChat);
  assert.equal("typeface" in settings, false);
});

test("normalizes HUI-owned profile and labs", () => {
  const settings = normalizeSettings({
    profileName: "  Alex  ", profileHandle: " @alex ",
    labs: { denseObservability: true, detailedDebug: "yes" },
  });
  assert.equal(settings.profileName, "Alex");
  assert.equal(settings.profileHandle, "@alex");
  assert.deepEqual(settings.labs, { denseObservability: true, detailedDebug: false });
});

test("the managed browser is on and headless unless explicitly changed", () => {
  assert.deepEqual(DEFAULT_SETTINGS.browser, { enabled: true, headless: true, executablePath: "" });
  assert.deepEqual(normalizeSettings({}).browser, DEFAULT_SETTINGS.browser);
  assert.deepEqual(normalizeSettings({ browser: { enabled: "no", headless: 0, executablePath: 7 } }).browser, DEFAULT_SETTINGS.browser);
  assert.deepEqual(
    normalizeSettings({ browser: { enabled: false, headless: false, executablePath: "  /Applications/Brave Browser.app  " } }).browser,
    { enabled: false, headless: false, executablePath: "/Applications/Brave Browser.app" },
  );
  assert.equal(normalizeSettings({ browser: { executablePath: "/usr/bin/chrome\n--flag" } }).browser.executablePath, "");
  assert.equal(normalizeSettings({ browser: { executablePath: `/${"x".repeat(5_000)}` } }).browser.executablePath, "");
});

test("the Bots tab is opt-in: only an explicit true shows it", () => {
  assert.deepEqual(DEFAULT_SETTINGS.bots, { showTab: false });
  assert.deepEqual(normalizeSettings({}).bots, { showTab: false });
  for (const bots of [null, "yes", [], { showTab: "true" }, { showTab: 1 }]) {
    assert.deepEqual(normalizeSettings({ bots }).bots, { showTab: false }, JSON.stringify(bots));
  }
  assert.deepEqual(normalizeSettings({ bots: { showTab: true, extra: 1 } }).bots, { showTab: true });
  // A saved choice survives the client/server round trip.
  assert.deepEqual(normalizeSettings(JSON.parse(JSON.stringify(normalizeSettings({ bots: { showTab: true } })))).bots, { showTab: true });
});

test("keeping the Mac awake is opt-out and lid-close prevention is never saved", () => {
  assert.deepEqual(normalizeSettings({}).power, { keepAwake: true });
  assert.deepEqual(normalizeSettings({ power: { keepAwake: "no" } }).power, { keepAwake: true });
  assert.deepEqual(normalizeSettings({ power: { keepAwake: false, lidAwake: true } }).power, { keepAwake: false });
});

test("normalizes OpenClaw-compatible chat preferences", () => {
  assert.deepEqual(normalizeSettings({ chat: {
    messageWidth: "wide",
    collapseTaskProgress: true,
    sendShortcut: "modifierEnter",
    githubEmbeds: false,
  } }).chat, {
    messageWidth: "wide",
    collapseTaskProgress: true,
    sendShortcut: "modifierEnter",
    githubEmbeds: false,
  });
  assert.deepEqual(normalizeSettings({ chat: {
    messageWidth: "huge",
    collapseTaskProgress: "yes",
    sendShortcut: "space",
    githubEmbeds: "no",
  } }).chat, DEFAULT_SETTINGS.chat);
  assert.equal(DEFAULT_SETTINGS.chat.githubEmbeds, true);
});

test("drops the retired dashboard widget preference from legacy files", () => {
  const settings = normalizeSettings({ dashboardWidgets: ["gateway", "usage"] });
  assert.equal("dashboardWidgets" in settings, false);
});

// settings.json is meant to be hand-editable, and both the server and the
// client read it, so anything unexpected has to land on a default rather than
// reaching CSS or a lookup.
test("fills in what a partial file leaves out", () => {
  assert.deepEqual(normalizeSettings({ themeMode: "light" }), {
    ...DEFAULT_SETTINGS,
    themeMode: "light",
  });
  assert.deepEqual(normalizeSettings({}), DEFAULT_SETTINGS);
});

test("rejects junk in every field", () => {
  assert.deepEqual(normalizeSettings(null), DEFAULT_SETTINGS);
  assert.deepEqual(normalizeSettings("nope"), DEFAULT_SETTINGS);
  assert.deepEqual(normalizeSettings([]), DEFAULT_SETTINGS);
  assert.deepEqual(
    normalizeSettings({ theme: 42, themeMode: "chartreuse", fontUi: {}, fontChat: [], textScale: "big" }),
    DEFAULT_SETTINGS,
  );
});

test("keeps an unknown theme id, so a missing theme is not a lost setting", () => {
  // The client falls back to the first available theme; dropping the id here
  // would silently forget what the user picked.
  assert.equal(normalizeSettings({ theme: "not-installed" }).theme, "not-installed");
  assert.equal(normalizeSettings({ theme: "  spaced  " }).theme, "spaced");
});

test("accepts only a complete hex accent override", () => {
  assert.equal(normalizeSettings({ accent: " #A78BFA " }).accent, "#a78bfa");
  for (const accent of ["red", "#fff", "#gg55cc", "var(--accent)", 42]) {
    assert.equal(normalizeSettings({ accent }).accent, "");
  }
});

test("disabled skills keep bounded stable identities and discard malformed entries", () => {
  assert.deepEqual(normalizeSettings({
    disabledSkills: [
      { name: "pdf", path: "/skills/pdf/SKILL.md" },
      { name: "duplicate", path: "/skills/pdf/SKILL.md" },
      { name: "", path: "/skills/empty/SKILL.md" },
      { name: "bad", path: "/skills/bad\npath" },
      "not-an-entry",
    ],
  }).disabledSkills, [{ name: "pdf", path: "/skills/pdf/SKILL.md" }]);
});

test("disabled plugins keep opaque resource identities and discard malformed entries", () => {
  assert.deepEqual(normalizeSettings({
    disabledPlugins: [
      { id: "0123456789abcdef01234567", name: "review-tools", kind: "package" },
      { id: "0123456789abcdef01234567", name: "duplicate", kind: "extension" },
      { id: "not-an-id", name: "bad", kind: "package" },
      { id: "fedcba9876543210fedcba98", name: "", kind: "extension" },
    ],
  }).disabledPlugins, [
    { id: "0123456789abcdef01234567", name: "review-tools", kind: "package" },
  ]);
});

test("normalizes a safe worktree branch prefix", () => {
  assert.equal(normalizeBranchPrefix("developer"), "developer/");
  assert.equal(normalizeBranchPrefix(" team/feature/ "), "team/feature/");
  for (const prefix of ["", "/feature", "feature//nested", "../escape", "bad prefix", "topic.lock/"]) {
    assert.equal(normalizeBranchPrefix(prefix), "feature/");
  }
});

test("voice notes wait in the composer unless sending them at once is switched on", () => {
  assert.deepEqual(DEFAULT_SETTINGS.voice, { sendNotesImmediately: false });
  for (const voice of [undefined, null, "yes", [], { sendNotesImmediately: "true" }, { sendNotesImmediately: 1 }]) {
    assert.deepEqual(normalizeSettings({ voice }).voice, { sendNotesImmediately: false }, JSON.stringify(voice));
  }
  assert.deepEqual(normalizeSettings({ voice: { sendNotesImmediately: true, url: "never here" } }).voice, { sendNotesImmediately: true });
});
