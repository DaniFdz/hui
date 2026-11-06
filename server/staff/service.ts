/**
 * Seeds and maintains the staff pack (`staff/`, pack.ts) in one bot: the Chief of
 * Staff a fresh HUI creates once, or the bot an earlier version of HUI seeded. It
 * writes the pack's skills into the bot's own skill folder, merges the pack's
 * default subagent routes into Settings by name (never replacing one the operator
 * edited), and records what it installed in `staff.json` so an upgrade can tell a
 * file nobody touched from one the operator changed.
 *
 * It seeds once and never resurrects a deleted bot: the record outlives the bot,
 * which is how deleting the Chief of Staff opts out. SOUL.md, USER.md, MEMORY.md
 * and BOOTSTRAP.md are never written after creation, and a skill with any edited
 * file is kept whole and reported, never overwritten. A pack skill the operator
 * removed is not re-added.
 */
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { CONFIG_DIR } from "../paths.ts";
import type { Settings } from "../hui-settings.ts";
import type { BotSkillFiles, BotOwnSkill } from "../bots/skills.ts";
import { hashText, packFilePaths, type StaffPack, type StaffRoute } from "./pack.ts";

/** Where HUI records the seeded pack, next to `bots.json`. */
export const STAFF_STATE_FILE = join(CONFIG_DIR, "staff.json");

/** What the installer needs from HUI; tests supply fakes. */
export type StaffDeps = {
  pack: StaffPack;
  createBot: (body: { name: string; title: string; description: string; soul: string }) => Promise<{ id: string }>;
  /** Every bot this gateway knows, by id (an archived bot is still one). */
  botIds: () => Promise<readonly string[]>;
  skills: Pick<BotSkillFiles, "read" | "write">;
  readSettings: () => Promise<Settings>;
  writeSettings: (settings: Settings) => Promise<Settings>;
  stateFile?: string;
  now?: () => Date;
};

/** The installed pack: which bot got it, which pack version, and the hash of every file it installed. */
export type StaffState = {
  version: 1;
  packVersion: number;
  seededAt: string;
  botId: string;
  /** `skills/<name>/<file>` to the hash of the text HUI installed, never the operator's edits. */
  files: Record<string, string>;
};

export type StaffOutcome = {
  seeded: boolean;
  botId: string;
  /** Skills written this run. */
  written: string[];
  /** Skills kept because the operator or the bot changed one of their files. */
  kept: string[];
  routesAdded: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function statePath(deps: StaffDeps): string {
  return deps.stateFile ?? STAFF_STATE_FILE;
}

/** The recorded state, or undefined while HUI never seeded a pack. A corrupt record is treated as absent. */
export async function readStaffState(deps: Pick<StaffDeps, "stateFile">): Promise<StaffState | undefined> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(deps.stateFile ?? STAFF_STATE_FILE, "utf8"));
  } catch {
    return undefined;
  }
  if (!isRecord(raw) || typeof raw["botId"] !== "string" || !raw["botId"]) return undefined;
  const files: Record<string, string> = {};
  if (isRecord(raw["files"])) {
    for (const [path, hash] of Object.entries(raw["files"])) if (typeof hash === "string") files[path] = hash;
  }
  return {
    version: 1,
    packVersion: typeof raw["packVersion"] === "number" ? raw["packVersion"] : 0,
    seededAt: typeof raw["seededAt"] === "string" ? raw["seededAt"] : "",
    botId: raw["botId"],
    files,
  };
}

async function writeStaffState(deps: StaffDeps, state: StaffState): Promise<void> {
  const file = statePath(deps);
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, file);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

/** The installed text of every pack file, by its pack path, from one bot's own skills. */
function installedText(skills: readonly BotOwnSkill[]): Map<string, string> {
  const installed = new Map<string, string>();
  for (const skill of skills) {
    installed.set(`skills/${skill.name}/SKILL.md`, skill.text);
    for (const file of skill.files ?? []) installed.set(`skills/${skill.name}/${file.path}`, file.text);
  }
  return installed;
}

/** A skill nobody edited since HUI installed it: every installed file still has the recorded hash. */
function untouched(state: StaffState, installed: Map<string, string>, skill: StaffPack["skills"][number]): boolean {
  return packFilePaths([skill]).every((file) => {
    const text = installed.get(file.path);
    return text !== undefined && state.files[file.path] === hashText(text);
  });
}

/** What to do with one skill: install it, update it because nobody touched it and its text changed, keep an edited
 * one, or leave it alone because it already matches the pack. */
function decision(state: StaffState, installed: Map<string, string>, skill: StaffPack["skills"][number]): "write" | "keep" | "skip" {
  if (!installed.has(`skills/${skill.name}/SKILL.md`)) return "write";
  if (!untouched(state, installed, skill)) return "keep";
  return packFilePaths([skill]).some((file) => installed.get(file.path) !== file.text) ? "write" : "skip";
}

/**
 * Writes the pack's skills and merges its routes. Seeds the bot first when HUI
 * never did; a bot the operator deleted stays deleted. `seed: false` never
 * creates a bot (hui doctor --fix).
 */
export async function ensureStaff(deps: StaffDeps, options: { seed?: boolean } = {}): Promise<StaffOutcome> {
  const seed = options.seed !== false;
  let state = await readStaffState(deps);
  let seeded = false;
  if (!state) {
    if (!seed) throw new Error("The staff pack was never installed on this gateway.");
    const bot = await deps.createBot({
      name: deps.pack.bot.name,
      title: deps.pack.bot.title,
      description: deps.pack.bot.description,
      soul: deps.pack.soul,
    });
    state = { version: 1, packVersion: deps.pack.version, seededAt: (deps.now?.() ?? new Date()).toISOString(), botId: bot.id, files: {} };
    // Recorded before the files go in, so a crash in between cannot seed a second bot.
    await writeStaffState(deps, state);
    seeded = true;
  }

  const known = await deps.botIds();
  const written: string[] = [];
  const kept: string[] = [];
  if (known.includes(state.botId)) {
    const installed = installedText(await deps.skills.read(state.botId));
    const next: BotOwnSkill[] = [];
    for (const skill of deps.pack.skills) {
      const action = decision(state, installed, skill);
      if (action === "skip") continue;
      if (action === "keep") {
        kept.push(skill.name);
        continue;
      }
      next.push({ name: skill.name, text: skill.text, ...(skill.files.length ? { files: skill.files } : {}) });
      written.push(skill.name);
    }
    if (next.length) await deps.skills.write(state.botId, next);
    for (const skill of deps.pack.skills) {
      if (!written.includes(skill.name)) continue;
      for (const file of packFilePaths([skill])) state.files[file.path] = hashText(file.text);
    }
  }

  const routesAdded = await mergeRoutes(deps, deps.pack.routes);
  state.packVersion = deps.pack.version;
  await writeStaffState(deps, state);
  return { seeded, botId: state.botId, written, kept, routesAdded };
}

/** Adds the pack's routes the operator does not have, by name only. Never replaces or removes one. */
async function mergeRoutes(deps: StaffDeps, routes: readonly StaffRoute[]): Promise<string[]> {
  const settings = await deps.readSettings();
  const existing = new Set(settings.models.routes.map((route) => route.name));
  const missing = routes.filter((route) => !existing.has(route.name));
  if (!missing.length) return [];
  await deps.writeSettings({
    ...settings,
    models: { ...settings.models, routes: [...settings.models.routes, ...missing.map((route) => ({ ...route }))] },
  });
  return missing.map((route) => route.name);
}

/** What hui doctor reports: the recorded pack against the shipped one, and which skills the operator changed. */
export type StaffStatus = {
  installed: boolean;
  botId?: string;
  packVersion: number;
  shippedVersion: number;
  upToDate: boolean;
  kept: string[];
};

export async function staffStatus(deps: StaffDeps): Promise<StaffStatus> {
  const state = await readStaffState(deps);
  if (!state) return { installed: false, packVersion: 0, shippedVersion: deps.pack.version, upToDate: false, kept: [] };
  const known = await deps.botIds();
  if (!known.includes(state.botId)) return { installed: false, botId: state.botId, packVersion: state.packVersion, shippedVersion: deps.pack.version, upToDate: false, kept: [] };
  const installed = installedText(await deps.skills.read(state.botId));
  const kept = deps.pack.skills.filter((skill) => installed.has(`skills/${skill.name}/SKILL.md`) && !untouched(state, installed, skill)).map((skill) => skill.name);
  const allUntouched = deps.pack.skills.every((skill) => installed.has(`skills/${skill.name}/SKILL.md`) && untouched(state, installed, skill));
  return {
    installed: true,
    botId: state.botId,
    packVersion: state.packVersion,
    shippedVersion: deps.pack.version,
    upToDate: state.packVersion === deps.pack.version && allUntouched,
    kept,
  };
}


/** What an upgrade would do, without doing it: which skills get the shipped text, which are kept as edited. */
export async function staffPlan(deps: StaffDeps): Promise<{ botId?: string; updates: string[]; kept: string[] }> {
  const state = await readStaffState(deps);
  if (!state) return { updates: [], kept: [] };
  const known = await deps.botIds();
  if (!known.includes(state.botId)) return { botId: state.botId, updates: [], kept: [] };
  const installed = installedText(await deps.skills.read(state.botId));
  const updates: string[] = [];
  const kept: string[] = [];
  for (const skill of deps.pack.skills) {
    const action = decision(state, installed, skill);
    if (action === "write") updates.push(skill.name);
    if (action === "keep") kept.push(skill.name);
  }
  return { botId: state.botId, updates, kept };
}
