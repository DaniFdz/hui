/**
 * Seeds and maintains the staff pack (`staff/`, pack.ts) in every bot that carries it: the Chief of Staff a fresh HUI
 * creates once, and each group chief `POST /__hui/staff/chiefs` installed the pack into. It writes the pack's skills
 * into a bot's own skill folder, merges the pack's default subagent routes into Settings by name (never replacing one
 * the operator edited), and records per bot what it installed in `staff.json`, so an upgrade can tell a file nobody
 * touched from one the operator changed.
 *
 * It seeds once and never resurrects a deleted bot: the seeded record outlives the bot, which is how deleting the
 * Chief of Staff opts out. A group chief with no record yet (one HUI installed the pack into before it recorded each
 * bot) is adopted the first time this runs: every file it already holds byte for byte is recorded, a skill it lacks is
 * installed, and a skill that differs is kept and reported, because the record cannot yet tell an operator's edit from
 * older pack text. SOUL.md, USER.md, MEMORY.md and BOOTSTRAP.md are never written after creation, and a skill with any
 * edited file is kept whole and reported, never overwritten. A pack skill the operator removed is not re-added.
 */
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { CONFIG_DIR } from "../paths.ts";
import type { Settings } from "../hui-settings.ts";
import type { BotSkillFiles, BotOwnSkill } from "../bots/skills.ts";
import { isChiefTitle } from "../bots/chief-title.ts";
import { hashText, packFilePaths, type StaffPack, type StaffRoute } from "./pack.ts";

/** Where HUI records the pack it seeded and what each chief holds, next to `bots.json`. */
export const STAFF_STATE_FILE = join(CONFIG_DIR, "staff.json");

/** One bot as the installer sees it: the title that marks a chief, the group it is chief of, and the worker that keeps
 * its home. */
export type StaffBot = {
  id: string;
  name: string;
  title?: string;
  /** The custom session group this bot is the chief of; absent for a bot that belongs to none. */
  group?: string;
  /** The worker its chat and home folder live on; absent: this machine. */
  worker?: string;
};

/** What the installer needs from HUI; tests supply fakes. */
export type StaffDeps = {
  pack: StaffPack;
  createBot: (body: { name: string; title: string; description: string; soul: string }) => Promise<{ id: string }>;
  /** Every bot this gateway knows, an archived one included. */
  bots: () => Promise<readonly StaffBot[]>;
  skills: Pick<BotSkillFiles, "read" | "write">;
  readSettings: () => Promise<Settings>;
  writeSettings: (settings: Settings) => Promise<Settings>;
  stateFile?: string;
  now?: () => Date;
};

/** What the pack installed in one bot: the version it was last brought to, and the hash of every file HUI wrote. */
export type StaffBotState = {
  packVersion: number;
  installedAt: string;
  /** `skills/<name>/<file>` to the hash of the text HUI installed, never the operator's edits. */
  files: Record<string, string>;
};

/** The installed pack: the seeded Chief of Staff, and what the pack holds in each chief. */
export type StaffState = {
  version: 2;
  seededAt: string;
  /** The bot HUI seeded. Deleting it is the opt-out; every other chief is a group's. */
  botId: string;
  /** Bot id → what the pack installed there. */
  bots: Record<string, StaffBotState>;
};

/** What one run did in one bot. */
export type StaffBotOutcome = {
  botId: string;
  /** The bot held pack text but no record: this run recorded it. */
  adopted: boolean;
  written: string[];
  /** Skills kept because a file of theirs differs from the pack. */
  kept: string[];
};

export type StaffOutcome = {
  seeded: boolean;
  botId: string;
  bots: StaffBotOutcome[];
  routesAdded: string[];
};

/** One bot's worth of what an upgrade would do, without doing it. */
export type StaffBotPlan = {
  botId: string;
  name: string;
  adopted: boolean;
  /** Skills that take the shipped text: missing here, or untouched since HUI installed them. */
  updates: string[];
  /** Skills kept because a file differs from the shipped text, which the pack never overwrites. */
  kept: string[];
  /** The kept skills of `kept` whose difference HUI cannot account for: it has no record of installing them there, so
   * the text is either the operator's or an older pack's. Reported apart, because the operator is the only one who can
   * say which. */
  unrecorded: string[];
  /** Skills the pack no longer ships that this bot still holds untouched: reported, never deleted. */
  stale: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hashes(raw: unknown): Record<string, string> {
  const files: Record<string, string> = {};
  if (isRecord(raw)) for (const [path, hash] of Object.entries(raw)) if (typeof hash === "string") files[path] = hash;
  return files;
}

function statePath(deps: Pick<StaffDeps, "stateFile">): string {
  return deps.stateFile ?? STAFF_STATE_FILE;
}

/** One writer at a time for `staff.json`: two chiefs created at once, or a creation during a start, must not each read
 * the same records and drop the other's. Same chain as the bot registry keeps for `bots.json`. */
let queued: Promise<unknown> = Promise.resolve();
function serialized<T>(operation: () => Promise<T>): Promise<T> {
  const run = queued.then(operation, operation);
  queued = run.catch(() => undefined);
  return run;
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
  const bots: Record<string, StaffBotState> = {};
  if (isRecord(raw["bots"])) {
    for (const [id, entry] of Object.entries(raw["bots"])) {
      if (!isRecord(entry)) continue;
      bots[id] = {
        packVersion: typeof entry["packVersion"] === "number" ? entry["packVersion"] : 0,
        installedAt: typeof entry["installedAt"] === "string" ? entry["installedAt"] : "",
        files: hashes(entry["files"]),
      };
    }
  }
  const seededAt = typeof raw["seededAt"] === "string" ? raw["seededAt"] : "";
  // Before version 2 the seeded bot's hashes sat at the top level, and it was the only bot recorded.
  if (!bots[raw["botId"]]) {
    bots[raw["botId"]] = {
      packVersion: typeof raw["packVersion"] === "number" ? raw["packVersion"] : 0,
      installedAt: seededAt,
      files: hashes(raw["files"]),
    };
  }
  return { version: 2, seededAt, botId: raw["botId"], bots };
}

async function writeStaffState(deps: StaffDeps, state: StaffState): Promise<void> {
  const file = statePath(deps);
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.tmp`;
  // The seeded bot's hashes are also written where version 1 kept them: `hui update --rollback` runs a release whose
  // reader only knows that shape, so it must not find a file it reads as "nothing installed" and rewrite as version 1.
  const seeded = state.bots[state.botId];
  const written = { ...state, ...(seeded ? { packVersion: seeded.packVersion, files: seeded.files } : {}) };
  try {
    await writeFile(temporary, `${JSON.stringify(written, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
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

/** A skill nobody touched since HUI installed it: every file it recorded there is still present with its hash, and the
 * folder holds nothing HUI did not write. Read from the record rather than the shipped pack, so a file a later version
 * adds does not look like an edit, and one it drops is not forgotten. */
function untouched(files: Record<string, string>, installed: Map<string, string>, skill: StaffPack["skills"][number]): boolean {
  const prefix = `skills/${skill.name}/`;
  const mine = Object.entries(files).filter(([path]) => path.startsWith(prefix));
  const held = [...installed.keys()].filter((path) => path.startsWith(prefix));
  return mine.length > 0 && mine.length === held.length && mine.every(([path, hash]) => {
    const text = installed.get(path);
    return text !== undefined && hashText(text) === hash;
  });
}

/** What to do with one skill: install it, update it because nobody touched it and its text changed, keep an edited
 * one, or leave it alone because it already matches the pack. */
function decision(files: Record<string, string>, installed: Map<string, string>, skill: StaffPack["skills"][number]): "write" | "keep" | "skip" {
  if (!installed.has(`skills/${skill.name}/SKILL.md`)) return "write";
  if (!untouched(files, installed, skill)) return "keep";
  return packFilePaths([skill]).some((file) => installed.get(file.path) !== file.text) ? "write" : "skip";
}

/** The record an adopted chief starts from: the shipped hash of every file it already holds byte for byte. A file it
 * holds in other text keeps no hash, so the pack keeps and reports it instead of guessing it was a shipped version. */
function adoptedFiles(installed: Map<string, string>, pack: StaffPack): Record<string, string> {
  const files: Record<string, string> = {};
  for (const file of packFilePaths(pack.skills)) if (installed.get(file.path) === file.text) files[file.path] = hashText(file.text);
  return files;
}

/** Whether a bot holds any of the shipped pack text: the sign that HUI installed the pack into it. A group and a chief
 * title alone would adopt a bot the operator filed under a group. */
function holdsPack(installed: Map<string, string>, pack: StaffPack): boolean {
  return packFilePaths(pack.skills).some((file) => installed.get(file.path) === file.text);
}

/** Skills a bot still holds whole from a pack that no longer ships them at all: the folder is there, every file of it is
 * recorded and still matches. A file the pack dropped from a skill it still ships is not one, a folder already deleted
 * is not one, and neither is a folder with a file anybody touched or added, because deleting that folder would take text
 * the pack never owned. Reported, never deleted. */
function staleSkills(botState: StaffBotState, installed: Map<string, string>, pack: StaffPack): string[] {
  const shipped = new Set(packFilePaths(pack.skills).map((file) => file.path));
  const names = new Set<string>();
  for (const path of Object.keys(botState.files)) {
    if (shipped.has(path) || !/^skills\/[^/]+\/SKILL\.md$/u.test(path)) continue;
    names.add(path.split("/")[1]!);
  }
  return [...names].filter((name) => installed.has(`skills/${name}/SKILL.md`)
    && [...installed].every(([path, text]) => !path.startsWith(`skills/${name}/`) || botState.files[path] === hashText(text))).sort();
}

/** Whether a kept skill is provably one HUI wrote and somebody then changed: a file of it carries a recorded hash and no
 * longer matches. Without that proof, the difference is as likely to be an older pack's text, and only the operator can
 * say which it is. */
function edited(files: Record<string, string>, installed: Map<string, string>, skill: StaffPack["skills"][number]): boolean {
  return packFilePaths([skill]).some((file) => {
    const hash = files[file.path];
    if (hash === undefined) return false;
    const text = installed.get(file.path);
    return text === undefined || hashText(text) !== hash;
  });
}

/** Every bot this run maintains, with the record it works from and the skills it holds: a recorded bot that still
 * exists, plus a group chief holding pack text that has none yet. A deleted bot, and one whose home is on a worker, is
 * left alone. */
async function targets(deps: StaffDeps, bots: readonly StaffBot[], state: StaffState): Promise<{ bot: StaffBot; recorded?: StaffBotState; installed: Map<string, string> }[]> {
  const kept: { bot: StaffBot; recorded?: StaffBotState; installed: Map<string, string> }[] = [];
  for (const bot of bots) {
    const recorded = state.bots[bot.id];
    // A chief HUI never recorded needs its title as well as its group: `group` is an ordinary field the operator can set
    // on any bot, and a bot with one copied pack skill must not receive the rest.
    if (bot.worker || (!recorded && !(bot.group && isChiefTitle(bot.title)))) continue;
    const installed = installedText(await deps.skills.read(bot.id));
    if (recorded || holdsPack(installed, deps.pack)) kept.push({ bot, recorded, installed });
  }
  return kept;
}

/** What one bot needs, read from its own skills and its record; `state` is the record to write back. */
function review(deps: StaffDeps, recorded: StaffBotState | undefined, installed: Map<string, string>) {
  const adopted = !recorded;
  const state: StaffBotState = recorded ?? {
    packVersion: deps.pack.version,
    installedAt: (deps.now?.() ?? new Date()).toISOString(),
    files: adoptedFiles(installed, deps.pack),
  };
  const writes: BotOwnSkill[] = [];
  const kept: string[] = [];
  const unrecorded: string[] = [];
  const installedHashes: Record<string, string> = {};
  for (const skill of deps.pack.skills) {
    const action = decision(state.files, installed, skill);
    if (action === "skip") continue;
    if (action === "keep") {
      kept.push(skill.name);
      if (!edited(state.files, installed, skill)) unrecorded.push(skill.name);
      continue;
    }
    writes.push({ name: skill.name, text: skill.text, ...(skill.files.length ? { files: skill.files } : {}) });
    for (const file of packFilePaths([skill])) installedHashes[file.path] = hashText(file.text);
  }
  return { adopted, state, writes, installedHashes, kept, unrecorded, stale: staleSkills(state, installed, deps.pack) };
}

/**
 * Writes the pack's skills into every chief and merges its routes. Seeds the Chief of Staff first when HUI never did;
 * a bot the operator deleted stays deleted. `seed: false` never creates a bot (hui doctor --fix).
 */
export async function ensureStaff(deps: StaffDeps, options: { seed?: boolean } = {}): Promise<StaffOutcome> {
  return serialized(() => install(deps, options));
}

async function install(deps: StaffDeps, options: { seed?: boolean }): Promise<StaffOutcome> {
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
    state = {
      version: 2,
      seededAt: (deps.now?.() ?? new Date()).toISOString(),
      botId: bot.id,
      bots: { [bot.id]: { packVersion: deps.pack.version, installedAt: (deps.now?.() ?? new Date()).toISOString(), files: {} } },
    };
    // Recorded before the files go in, so a crash in between cannot seed a second bot.
    await writeStaffState(deps, state);
    seeded = true;
  }

  const outcomes: StaffBotOutcome[] = [];
  for (const { bot, recorded, installed } of await targets(deps, await deps.bots(), state)) {
    const { adopted, state: next, writes, installedHashes, kept } = review(deps, recorded, installed);
    if (writes.length) await deps.skills.write(bot.id, writes);
    Object.assign(next.files, installedHashes);
    if (writes.length || adopted) {
      next.packVersion = deps.pack.version;
      state.bots[bot.id] = next;
      // Recorded before the next bot, so a failure there cannot lose what this one received.
      await writeStaffState(deps, state);
    }
    if (writes.length || kept.length || adopted) outcomes.push({ botId: bot.id, adopted, written: writes.map((skill) => skill.name), kept });
  }

  const routesAdded = await mergeRoutes(deps, deps.pack.routes);
  if (seeded) await writeStaffState(deps, state);
  return { seeded, botId: state.botId, bots: outcomes, routesAdded };
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

/** Records the pack HUI has just written into a chief, so the next start can tell its files from the operator's. A
 * gateway that never seeded a pack has nothing to record into, and the next start seeds one. */
export async function recordChief(deps: StaffDeps, botId: string): Promise<void> {
  return serialized(async () => {
    const state = await readStaffState(deps);
    if (!state) return;
    const files: Record<string, string> = {};
    for (const file of packFilePaths(deps.pack.skills)) files[file.path] = hashText(file.text);
    state.bots[botId] = { packVersion: deps.pack.version, installedAt: (deps.now?.() ?? new Date()).toISOString(), files };
    await writeStaffState(deps, state);
  });
}

/** What an upgrade would do, without doing it: which skills get the shipped text, which are kept as edited, and which
 * the pack no longer ships. A record HUI never wrote is not created here. */
export async function staffPlan(deps: StaffDeps): Promise<{ botId?: string; bots: StaffBotPlan[] }> {
  const state = await readStaffState(deps);
  if (!state) return { bots: [] };
  return {
    botId: state.botId,
    bots: (await targets(deps, await deps.bots(), state)).map(({ bot, recorded, installed }) => {
      const { adopted, writes, kept, unrecorded, stale } = review(deps, recorded, installed);
      return { botId: bot.id, name: bot.name, adopted, updates: writes.map((skill) => skill.name), kept, unrecorded, stale };
    }),
  };
}
