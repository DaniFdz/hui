/**
 * `hui doctor`: the staff pack (staff/). The gateway seeds the Chief of Staff once and installs the pack's skills into
 * its home and into each group chief's; this check reports, per bot, a shipped skill whose text changed, which `--fix`
 * installs, a skill the operator or the bot edited, which the pack never overwrites, and a skill the pack no longer
 * ships, which the operator can delete. A gateway that never seeded a pack is fine (the next start does), and a
 * deleted Chief of Staff is an opt-out, not a problem.
 */
import { readFile } from "node:fs/promises";

import { BOTS_FILE } from "../server/bots/bots.ts";
import { localBotSkills } from "../server/bots/skills.ts";
import { readHuiSettings, writeHuiSettings } from "../server/hui-settings.ts";
import { readStaffPack } from "../server/staff/pack.ts";
import { ensureStaff, staffPlan, readStaffState, STAFF_STATE_FILE, type StaffBot, type StaffDeps } from "../server/staff/service.ts";
import type { DoctorCheck, DoctorItem, DoctorResult } from "./doctor-types.ts";

export type StaffDoctorOptions = {
  /** `staff.json`: the pack HUI installed. */
  stateFile?: string;
  /** `bots.json`, for the bots the pack belongs to. */
  botsFile?: string;
  /** Where bots keep their homes, for the skills the pack installs. */
  botsDir?: string;
};

/** The bots in bots.json; a missing or broken file leaves none, and the check reports the pack as not installed. */
async function bots(file: string): Promise<readonly StaffBot[]> {
  try {
    const parsed = JSON.parse(await readFile(file, "utf8")) as { bots?: unknown };
    return (Array.isArray(parsed.bots) ? parsed.bots : []).flatMap((raw) => {
      const record = raw as { id?: unknown; name?: unknown; title?: unknown; group?: unknown; worker?: unknown };
      // The same shape the registry accepts: a record it would refuse is not one whose skills can be read.
      if (typeof record.id !== "string" || !BOT_ID.test(record.id)) return [];
      return [{
        id: record.id,
        name: typeof record.name === "string" ? record.name : record.id,
        ...(typeof record.title === "string" ? { title: record.title } : {}),
        ...(typeof record.group === "string" ? { group: record.group } : {}),
        ...(typeof record.worker === "string" ? { worker: record.worker } : {}),
      }];
    });
  } catch {
    return [];
  }
}

/** A bot id the registry keeps, and the skill reader accepts. */
const BOT_ID = /^[A-Za-z0-9_-]{1,100}$/u;

export function createStaffCheck(options: StaffDoctorOptions = {}): DoctorCheck {
  const stateFile = options.stateFile ?? STAFF_STATE_FILE;
  const botsFile = options.botsFile ?? BOTS_FILE;

  async function deps(): Promise<StaffDeps> {
    return {
      pack: await readStaffPack(),
      stateFile,
      // --fix never seeds a bot: doctor runs with the gateway stopped, and a deleted one is an opt-out.
      createBot: async () => { throw new Error("hui doctor never creates the Chief of Staff; start the gateway instead."); },
      bots: () => bots(botsFile),
      skills: localBotSkills(options.botsDir),
      readSettings: readHuiSettings,
      writeSettings: writeHuiSettings,
    };
  }

  async function inspect(): Promise<DoctorResult> {
    const state = await readStaffState({ stateFile });
    if (!state) {
      return { id: "staff", title: "Staff pack", status: "ok", summary: "No staff pack installed yet", items: [], notes: ["Start the gateway once: it seeds the Chief of Staff and installs the pack's skills."] };
    }
    const plan = await staffPlan(await deps());
    const items: DoctorItem[] = plan.bots.flatMap((bot) => [
      ...bot.updates.map((name) => ({ id: `update:${bot.botId}:${name}`, label: `${bot.name}: skills/${name}`, status: "issue" as const, detail: "newer pack text is available: --fix installs it" })),
      ...bot.kept.map((name) => ({
        id: `kept:${bot.botId}:${name}`,
        label: `${bot.name}: skills/${name}`,
        status: "blocked" as const,
        detail: bot.unrecorded.includes(name)
          ? "differs from the shipped text, and HUI has no record of installing it here: delete its folder to take the shipped text, or keep your version"
          : "edited here, so the pack keeps it; remove the edit or copy the new version by hand",
      })),
      ...bot.stale.map((name) => ({ id: `stale:${bot.botId}:${name}`, label: `${bot.name}: skills/${name}`, status: "blocked" as const, detail: "the pack no longer ships this skill and it was not edited here: delete its folder to remove it" })),
    ]);
    const count = (of: "updates" | "kept" | "stale" | "unrecorded") => plan.bots.reduce((total, bot) => total + bot[of].length, 0);
    const updates = count("updates");
    const kept = count("kept");
    const unrecorded = count("unrecorded");
    const stale = count("stale");
    const adopted = plan.bots.filter((bot) => bot.adopted);
    return {
      id: "staff",
      title: "Staff pack",
      status: updates ? "issue" : "ok",
      summary: [
        ...(updates ? [`${updates} skill${updates === 1 ? "" : "s"} can take the shipped text`] : []),
        ...(kept ? [`${kept} skill${kept === 1 ? "" : "s"} kept${unrecorded ? ` (${unrecorded} with no install record)` : ""}`] : []),
        ...(stale ? [`${stale} skill${stale === 1 ? "" : "s"} the pack no longer ships`] : []),
      ].join("; ") || "Every chief's skills match the shipped pack",
      items,
      notes: [
        ...(plan.botId && !plan.bots.some((bot) => bot.botId === plan.botId)
          ? ["The Chief of Staff HUI seeded was deleted: that is how the operator opts out, and HUI does not seed another."]
          : []),
        ...(adopted.length
          ? [`${adopted.map((bot) => bot.name).join(", ")} got the pack before HUI recorded each chief: what already matches it byte for byte is recorded, what is missing is installed, and what differs is kept and reported as having no install record.`]
          : []),
        "The pack owns only skills/: SOUL.md, USER.md, MEMORY.md and BOOTSTRAP.md are the bot's and the operator's, and no upgrade writes them.",
      ],
    };
  }

  async function fix(): Promise<DoctorResult> {
    const before = await inspect();
    const updates = before.items.filter((item) => item.status === "issue");
    if (!updates.length) return before;
    const outcome = await ensureStaff(await deps(), { seed: false });
    const after = await inspect();
    const written = new Set(outcome.bots.flatMap((bot) => bot.written.map((name) => `${bot.botId}:${name}`)));
    const done: DoctorItem[] = updates.map((item) => {
      const installed = written.has(item.id.slice(item.id.indexOf(":") + 1));
      return { ...item, status: installed ? "fixed" as const : "failed" as const, detail: installed ? "installed the shipped text" : "the files changed while doctor ran" };
    });
    return {
      ...after,
      status: after.status === "issue" ? "issue" : done.some((item) => item.status === "failed") ? "issue" : "fixed",
      summary: done.some((item) => item.status === "failed") ? "Something could not be installed: see the failed items" : after.summary,
      items: [...done, ...after.items.filter((item) => !done.some((each) => each.id === item.id))],
    };
  }

  return { id: "staff", title: "Staff pack", inspect, fix };
}

export const staffCheck = createStaffCheck();
