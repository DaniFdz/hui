/** Appearance settings.json still carries: reported, and removed by --fix without losing what the gateway owns — and
 * the look alone exported for HUI's desktop app, which is the only way an operator keeps the appearance they had. */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, test } from "vitest";

// HUI's directory resolves at import time: never the operator's own.
const root = await mkdtemp(join(tmpdir(), "hui-doctor-appearance-"));
const config = join(root, "config", "hui");
const file = join(config, "settings.json");
const seedFile = join(config, "desktop-appearance.json");
process.env["HOME"] = root;
process.env["XDG_CONFIG_HOME"] = join(root, "config");
afterAll(() => rm(root, { recursive: true, force: true }));
const { appearanceCheck } = await import("./doctor-appearance.ts");
const { formatDoctorReport, runDoctor } = await import("./doctor.ts");

const doctor = () => runDoctor({ installation: { installationRoot: root, packageRoot: root }, checks: [appearanceCheck], gatewayStatus: async () => ({ status: "stopped" }), lock: (operation) => operation() });
const fix = () => runDoctor({ installation: { installationRoot: root, packageRoot: root }, checks: [appearanceCheck], fix: true, gatewayStatus: async () => ({ status: "stopped" }), lock: (operation) => operation() });
const write = async (value: unknown) => {
  await mkdir(config, { recursive: true });
  await writeFile(file, JSON.stringify(value));
};
const read = async () => JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
const seed = async () => JSON.parse(await readFile(seedFile, "utf8")) as Record<string, unknown>;

const LEGACY = {
  theme: "miami", themeMode: "dark", accent: "#5b9cf6", fontUi: "geist", fontChat: "lora", fontTerminal: "MesloLGS NF", textScale: 125,
  chat: { messageWidth: "wide", collapseTaskProgress: true, sendShortcut: "modifierEnter", githubEmbeds: false, datadogEmbeds: false, toolMarks: { pup: "🐶" } },
  name: "build-box",
};

test("a gateway with no settings file needs nothing, and the check creates neither file", async () => {
  assert.deepEqual(await doctor(), { ok: true, checks: [{ id: "appearance", title: "Appearance", status: "ok", summary: "no appearance is stored on the gateway", items: [], notes: [] }] });
  assert.equal(existsSync(config), false);
  assert.equal(existsSync(seedFile), false);
});

test("settings.json is reported for each appearance key it still carries, and the report writes nothing", async () => {
  await write(LEGACY);
  const report = await doctor();
  assert.equal(report.ok, false, "the file still holds state that a device owns now");
  assert.deepEqual(report.checks[0]!.items.map((item) => item.id), [
    "theme", "themeMode", "accent", "fontUi", "fontChat", "fontTerminal", "textScale",
    "chat.messageWidth", "chat.collapseTaskProgress", "chat.sendShortcut", "chat.githubEmbeds", "chat.datadogEmbeds",
  ]);
  assert.equal(report.checks[0]!.summary, "12 settings in settings.json belong to each device now");
  assert.match(report.checks[0]!.items[0]!.detail!, /"miami".*every device keeps its own now/u);
  assert.match(formatDoctorReport(report), /^✗ Appearance: 12 settings in settings.json belong to each device now$/mu);
  assert.doesNotMatch(formatDoctorReport(report), /chat\.toolMarks/u, "a tool's marks stay on the gateway");
  assert.deepEqual(await read(), LEGACY, "reporting changes nothing");
  assert.equal(existsSync(seedFile), false, "a report exports nothing");
});

test("--fix strips the keys, keeps every gateway setting, and exports the look alone for the desktop app", async () => {
  const report = await fix();
  assert.equal(report.ok, true);
  assert.equal(report.checks[0]!.status, "fixed");
  assert.match(report.checks[0]!.summary, /^removed 12 settings that belong to each device now; exported the look to .*desktop-appearance\.json for HUI's desktop app \(gateway "build-box"\)/u);
  assert.equal(report.checks[0]!.items.every((item) => item.status === "fixed"), true);

  const fixed = await read();
  for (const key of ["theme", "themeMode", "accent", "fontUi", "fontChat", "fontTerminal", "textScale"]) {
    assert.equal(key in fixed, false, key);
  }
  assert.deepEqual(fixed["chat"], { toolMarks: { pup: "🐶" }, toolIcons: {} }, "the marks stay, the moved chat preferences do not");
  assert.equal(fixed["name"], "build-box", "a gateway-owned setting survives");

  const exported = await seed();
  assert.equal(exported["format"], 1);
  assert.equal(exported["gateway"], "build-box");
  assert.match(String(exported["exportedAt"]), /^\d{4}-\d{2}-\d{2}T/u);
  assert.deepEqual(exported["appearance"], {
    theme: "miami", themeMode: "dark", accent: "#5b9cf6", fontUi: "geist", fontChat: "lora", fontTerminal: "MesloLGS NF", textScale: 125,
  }, "the look travels; the chat preferences are habits, not a screen");
  assert.deepEqual(await doctor(), { ok: true, checks: [{ id: "appearance", title: "Appearance", status: "ok", summary: "no appearance is stored on the gateway", items: [], notes: [] }] });
});

test("--fix exports nothing when the file only names what a fresh device already shows", async () => {
  await rm(seedFile, { force: true });
  await write({ theme: "claw", themeMode: "system", accent: "", fontUi: "instrument-sans", fontChat: "instrument-sans", fontTerminal: "JetBrains Mono", textScale: 100, name: "build-box" });
  const report = await fix();
  assert.equal(report.checks[0]!.status, "fixed");
  assert.match(report.checks[0]!.summary, /no look was exported: every value was already HUI's default$/u);
  assert.equal(existsSync(seedFile), false, "an export of defaults is noise");
  assert.equal((await read())["theme"], undefined);
});

test("--fix runs once: a file with nothing to move is not rewritten and exports nothing", async () => {
  await rm(seedFile, { force: true });
  const before = await read();
  const report = await fix();
  assert.equal(report.checks[0]!.status, "ok");
  assert.deepEqual(report.checks[0]!.items, []);
  assert.deepEqual(await read(), before);
  assert.equal(existsSync(seedFile), false);
});

test("a settings.json that does not parse is named rather than overwritten with defaults", async () => {
  await writeFile(file, "{ not json");
  const report = await doctor();
  assert.equal(report.ok, false);
  assert.equal(report.checks[0]!.summary, `${file} can't be read`);
  assert.deepEqual(report.checks[0]!.items, []);
  const fixed = await fix();
  assert.equal(fixed.checks[0]!.status, "issue");
  assert.equal(await readFile(file, "utf8"), "{ not json", "the operator's file is not replaced by a guess");
  assert.equal(existsSync(seedFile), false);
});
