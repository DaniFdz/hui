/**
 * `hui doctor`: the staff pack (staff/). The gateway seeds the Chief of Staff once and installs the pack's skills into
 * its home; this check reports a shipped skill whose text changed, which `--fix` installs, and a skill the operator or
 * the bot edited, which the pack never overwrites. A gateway that never seeded a pack is fine (the next start does),
 * and a deleted Chief of Staff is an opt-out, not a problem.
 */
import { readFile } from "node:fs/promises";

import { BOTS_FILE } from "../server/bots/bots.ts";
import { localBotSkills } from "../server/bots/skills.ts";
import { readHuiSettings, writeHuiSettings } from "../server/hui-settings.ts";
import { readStaffPack } from "../server/staff/pack.ts";
import { ensureStaff, staffPlan, readStaffState, STAFF_STATE_FILE, type StaffDeps } from "../server/staff/service.ts";
import type { DoctorCheck, DoctorItem, DoctorResult } from "./doctor-types.ts";

export type StaffDoctorOptions = {
  /** `staff.json`: the pack HUI installed. */
  stateFile?: string;
  /** `bots.json`, for the bot the pack belongs to. */
  botsFile?: string;
};

/** The ids in bots.json; a missing or broken file leaves none, and the check reports the pack as not installed. */
async function botIds(file: string): Promise<readonly string[]> {
  try {
    const parsed = JSON.parse(await readFile(file, "utf8")) as { bots?: unknown };
    return (Array.isArray(parsed.bots) ? parsed.bots : []).flatMap((raw) => {
      const id = (raw as { id?: unknown }).id;
      return typeof id === "string" ? [id] : [];
    });
  } catch {
    return [];
  }
}

export function createStaffCheck(options: StaffDoctorOptions = {}): DoctorCheck {
  const stateFile = options.stateFile ?? STAFF_STATE_FILE;
  const botsFile = options.botsFile ?? BOTS_FILE;

  async function deps(): Promise<StaffDeps> {
    return {
      pack: await readStaffPack(),
      stateFile,
      // --fix never seeds a bot: doctor runs with the gateway stopped, and a deleted one is an opt-out.
      createBot: async () => { throw new Error("hui doctor never creates the Chief of Staff; start the gateway instead."); },
      botIds: () => botIds(botsFile),
      skills: localBotSkills(),
      readSettings: readHuiSettings,
      writeSettings: writeHuiSettings,
    };
  }

  async function inspect(): Promise<DoctorResult> {
    const state = await readStaffState({ stateFile });
    if (!state) {
      return { id: "staff", title: "Staff pack", status: "ok", summary: "No staff pack installed yet", items: [], notes: ["Start the gateway once: it seeds the Chief of Staff and installs the pack's skills."] };
    }
    if (!(await botIds(botsFile)).includes(state.botId)) {
      return { id: "staff", title: "Staff pack", status: "ok", summary: "The Chief of Staff was deleted", items: [], notes: ["Deleting the bot is how the operator opts out; HUI does not seed another."] };
    }
    const { updates, kept } = await staffPlan(await deps());
    const items: DoctorItem[] = [
      ...updates.map((name) => ({ id: `update:${name}`, label: `skills/${name}`, status: "issue" as const, detail: "newer pack text is available: --fix installs it" })),
      ...kept.map((name) => ({ id: `kept:${name}`, label: `skills/${name}`, status: "blocked" as const, detail: "edited here, so the pack keeps it; remove the edit or copy the new version by hand" })),
    ];
    return {
      id: "staff",
      title: "Staff pack",
      status: updates.length ? "issue" : "ok",
      summary: [
        ...(updates.length ? [`${updates.length} skill${updates.length === 1 ? "" : "s"} can take the shipped text`] : []),
        ...(kept.length ? [`${kept.length} edited skill${kept.length === 1 ? "" : "s"} kept`] : []),
      ].join("; ") || "The Chief of Staff's skills match the shipped pack",
      items,
      notes: ["The pack owns only skills/: SOUL.md, USER.md, MEMORY.md and BOOTSTRAP.md are the bot's and the operator's, and no upgrade writes them."],
    };
  }

  async function fix(): Promise<DoctorResult> {
    const before = await inspect();
    const updates = before.items.filter((item) => item.status === "issue");
    if (!updates.length) return before;
    const outcome = await ensureStaff(await deps(), { seed: false });
    const after = await inspect();
    const done: DoctorItem[] = updates.map((item) => ({ ...item, status: outcome.written.includes(item.id.slice("update:".length)) ? "fixed" as const : "failed" as const, detail: outcome.written.length ? "installed the shipped text" : "the files changed while doctor ran" }));
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
