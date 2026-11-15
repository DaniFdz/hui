/**
 * `hui doctor`: chiefs from before the folder change. `POST /__hui/staff/chiefs` used to put a group chief's chat in the
 * group's project directory; a chief now works in its own bot folder (`bots/<id>`), and the group's project is where the
 * sessions it starts run. A chief whose chat works elsewhere is reported with both paths, and `--fix` moves it exactly as
 * Settings → Workspace does, while the gateway is stopped: the Durable conversation's directory first, then its session
 * record, then its bot record, so a crash between the steps leaves the check able to finish on its next run. The bot's
 * home, pack, group and project are never touched. A chief on a worker keeps its chat and home on that machine, which
 * doctor does not read offline, so it checks only the chiefs whose chats this machine keeps.
 */
import { constants } from "node:fs";
import { copyFile, mkdir, readFile, realpath, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { BOTS_DIR, BOTS_FILE, BotRegistry, parseBotRecord } from "../server/bots/bots.ts";
import { isChiefTitle } from "../server/bots/chief-title.ts";
import { backupRegistry, readRegistry, updateRegistry, type SessionRecord } from "../server/sessions/sessions.ts";
import type { BotRecord } from "../server/bots-format.ts";
import type { DoctorCheck, DoctorItem, DoctorResult } from "./doctor-types.ts";

const ID = "chiefs";
const TITLE = "Chief of Staff folders";

export type ChiefsDoctorOptions = {
  /** `bots.json`: the registry the gateway writes. */
  file?: string;
  /** The folder holding each bot's home, `<dir>/<id>`. */
  dir?: string;
};

/** The registry, as the check reads it: a broken file is reported, never thrown. A record the gateway would refuse is
 * not one whose folder can be judged. */
async function readBots(file: string): Promise<{ bots: readonly BotRecord[]; problem?: string }> {
  let source: string;
  try {
    source = await readFile(file, "utf8");
  } catch (error) {
    if ((error as { code?: unknown }).code === "ENOENT") return { bots: [] };
    return { bots: [], problem: `bots.json could not be read: ${error instanceof Error ? error.message : String(error)}` };
  }
  try {
    const parsed = JSON.parse(source) as { bots?: unknown };
    if (typeof parsed !== "object" || parsed === null || !Array.isArray(parsed.bots)) {
      return { bots: [], problem: "bots.json has an invalid shape: fix or move it, then run hui doctor again." };
    }
    return { bots: parsed.bots.flatMap((raw): BotRecord[] => {
      const bot = parseBotRecord(raw);
      return bot ? [bot] : [];
    }) };
  } catch {
    return { bots: [], problem: "bots.json is not valid JSON: fix or move it, then run hui doctor again." };
  }
}

/** Whether two paths name one directory: resolved, then as the filesystem resolves them when both can be, so a symlinked
 * configuration directory is not reported as a different folder. */
async function sameDirectory(a: string, b: string): Promise<boolean> {
  if (resolve(a) === resolve(b)) return true;
  const real = (path: string) => realpath(path).catch(() => path);
  return (await real(a)) === (await real(b));
}

/** Why a chief outside its folder cannot be moved now, or undefined when `--fix` can move it. */
async function blockedReason(own: string, record: SessionRecord | undefined): Promise<string | undefined> {
  if (!record) return "its chat is missing from HUI's session registry, so restore the record or the bot first";
  if (record.worker) return `its chat runs on ${record.worker}, so start the gateway there and move it in Settings → Workspace`;
  if (record.tool !== "durable" || !record.piSessionFile?.startsWith("durable:")) {
    return "its chat has no Durable conversation to move, so start the gateway and move it in Settings → Workspace";
  }
  // As for a PI session: a gateway sends an interrupted run a recovery prompt at its next start, and moving it first
  // would resume that run in another directory.
  if (record.runStartedAt) return "it has an interrupted run, so start the gateway and let the run finish or stop it, then run hui doctor --fix again";
  const folder = await stat(own).catch(() => undefined);
  if (!folder?.isDirectory()) return `its own folder ${own} is missing, so restore it first`;
  return undefined;
}

const label = (bot: BotRecord): string => `${bot.name} (@${bot.handle})`;

export function createChiefsCheck(options: ChiefsDoctorOptions = {}): DoctorCheck {
  const file = options.file ?? BOTS_FILE;
  const dir = options.dir ?? BOTS_DIR;

  async function inspect(): Promise<DoctorResult> {
    const { bots, problem } = await readBots(file);
    if (problem) {
      return { id: ID, title: TITLE, status: "issue", summary: "bots.json could not be read", items: [], notes: [problem] };
    }
    const chiefs = bots.filter((bot) => isChiefTitle(bot.title));
    const remote = chiefs.filter((bot) => bot.worker);
    const local = chiefs.filter((bot) => !bot.worker);
    const items: DoctorItem[] = [];
    let records: readonly SessionRecord[] | undefined;
    for (const bot of local) {
      const own = join(dir, bot.id);
      if (await sameDirectory(bot.cwd, own)) continue;
      records ??= await readRegistry();
      const blocked = await blockedReason(own, records.find((record) => record.id === bot.sessionId));
      items.push({
        id: bot.id,
        label: label(bot),
        status: blocked ? "blocked" : "issue",
        detail: `works in ${bot.cwd}, not in its own folder ${own}: ${blocked ?? "--fix moves its chat there"}`,
      });
    }
    const issues = items.filter((item) => item.status === "issue").length;
    const blocked = items.length - issues;
    const count = (n: number) => `${n} chief${n === 1 ? "" : "s"}`;
    return {
      id: ID,
      title: TITLE,
      status: items.length ? "issue" : "ok",
      summary: [
        ...(issues ? [`${count(issues)} still work${issues === 1 ? "s" : ""} outside ${issues === 1 ? "its" : "their"} own folder`] : []),
        ...(blocked ? [`${count(blocked)} need${blocked === 1 ? "s" : ""} the operator before moving`] : []),
      ].join("; ") || (chiefs.length ? "Every Chief of Staff on this machine works in its own folder" : "No Chief of Staff bot exists"),
      items,
      notes: [
        ...(issues ? ["hui doctor --fix moves each chief's chat to its own folder while the gateway is stopped; the sessions it starts still run in its group's project."] : []),
        ...(remote.length
          ? [`${remote.length === 1 ? "A chief" : `${remote.length} chiefs`} on a worker (${remote.map((bot) => `@${bot.handle}`).join(", ")}) keeps the chat and home there: hui doctor does not read a worker's home offline, so it does not check that folder.`]
          : []),
      ],
    };
  }

  /** Where `--fix` keeps its copy of each registry before the first write, as `hui doctor` promises. */
  async function backupBots(): Promise<string> {
    const directory = join(dirname(file), "backups");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const backup = join(directory, `bots-${new Date().toISOString().replace(/[:.]/gu, "-")}.json`);
    await copyFile(file, backup, constants.COPYFILE_EXCL);
    return backup;
  }

  async function fix(): Promise<DoctorResult> {
    const before = await inspect();
    if (!before.items.some((item) => item.status === "issue")) return before;
    const { bots } = await readBots(file);
    const records = await readRegistry();
    const done: DoctorItem[] = [];
    let host: import("../server/runtimes/durable-host.ts").DurableHost | undefined;
    let conversations: typeof import("../server/bots/conversations.ts") | undefined;
    let registryBackup: string | undefined;
    let botsBackup: string | undefined;
    /** Opens the store only once a chief really has to move, so an all-blocked report never touches it. */
    const store = async () => {
      if (host) return host;
      const [{ DurableHost, DURABLE_DIR }, imported, { resolvePiAgentDir }] = await Promise.all([
        import("../server/runtimes/durable-host.ts"),
        import("../server/bots/conversations.ts"),
        import("../server/pi/paths.ts"),
      ]);
      const created = new DurableHost({ dir: DURABLE_DIR, agentDir: resolvePiAgentDir(), resume: false });
      created.configureDurableBots(null);
      await created.open();
      host = created;
      conversations = imported;
      return created;
    };
    try {
      for (const item of before.items.filter((each) => each.status === "issue")) {
        const bot = bots.find((candidate) => candidate.id === item.id);
        if (!bot) continue;
        const own = join(dir, bot.id);
        try {
          // Another run moved it since the report: leave it, and leave no item for work already done.
          if (await sameDirectory(bot.cwd, own)) continue;
          const record = records.find((candidate) => candidate.id === bot.sessionId);
          const blocked = await blockedReason(own, record);
          if (blocked) throw new Error(blocked);
          if (!record?.piSessionFile) throw new Error("its chat has no Durable conversation to move");
          const durable = await store();
          // Both registries are copied before the first write, so an interrupted fix is retried from a known state.
          registryBackup ??= await backupRegistry();
          botsBackup ??= await backupBots();
          // The order is Settings → Workspace's: the chat's own directory, then its session record, then the bot whose
          // folder this check reads. A crash in between leaves the bot record stale, so the next run reports and finishes.
          await conversations!.configureBotConversation(durable, record.piSessionFile, { cwd: own });
          const sessions = await updateRegistry((current) => current.map((session) => session.id === record.id ? { ...session, cwd: own } : session));
          if (sessions.find((session) => session.id === record.id)?.cwd !== own) {
            throw new Error("its session record changed while doctor ran; run hui doctor again");
          }
          const now = new Date().toISOString();
          const updated = await new BotRegistry(file).update((current) => ({
            bots: current.map((each) => each.id === bot.id ? { ...each, cwd: own, updatedAt: now } : each),
            result: current.some((each) => each.id === bot.id),
          }));
          if (!updated) throw new Error("its bot record changed while doctor ran; run hui doctor again");
          done.push({ ...item, status: "fixed", detail: `moved its chat to ${own}` });
        } catch (error) {
          done.push({ ...item, status: "failed", detail: error instanceof Error ? error.message : String(error) });
        }
      }
    } finally {
      await host?.close();
    }
    const after = await inspect();
    if (!done.length) return after;
    const failed = done.some((item) => item.status === "failed");
    return {
      ...after,
      status: after.status === "issue" ? "issue" : failed ? "issue" : "fixed",
      summary: failed ? "Something could not be moved: see the failed items" : after.summary,
      items: [...done, ...after.items.filter((item) => !done.some((each) => each.id === item.id))],
      notes: [
        ...after.notes,
        ...(registryBackup ? [`Registry backup: ${registryBackup}`] : []),
        ...(botsBackup ? [`Bot registry backup: ${botsBackup}`] : []),
      ],
    };
  }

  return { id: ID, title: TITLE, inspect, fix };
}

export const chiefsCheck = createChiefsCheck();
