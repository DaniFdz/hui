/**
 * `POST /__hui/staff/chiefs`: the Chief of Staff for one custom session group. A group is a project here, so its chief
 * gets that project's directory as its cwd, its own OptChat memory (every bot has one) and its own copy of the staff
 * pack's skills in its home folder. Asking twice for the same group returns the chief it already has, restoring it if
 * it was archived, so the group's menu cannot create a second one.
 *
 * The pack is installed at creation: SOUL.md is the seed, and its skills are written into the new bot's own folder. The
 * routes are merged by name. A later pack update does not touch this bot yet (its per-bot manifest is the next step);
 * the operator can edit its skills in Tools & skills, and the pack never overwrites them.
 */
import { BotConflictError, BotInputError, BotNotFoundError, BotWorkerOfflineError } from "../bots/bots.ts";
import { localBotSkills, type BotSkillFiles } from "../bots/skills.ts";
import { BotResponse, type BotView } from "../api/bots.ts";
import { routeSchemas } from "../api/staff.ts";

export { routeSchemas };
import type { Settings } from "../hui-settings.ts";
import { reply, type RouteRequest, type RouteResult } from "../http/route.ts";
import { readStaffPack } from "../staff/pack.ts";

const ROUTE = /^\/__hui\/staff\/chiefs$/u;
const CONTROL = /[\p{Cc}]/u;

export type StaffRouteDeps = {
  /** The bot roster, by the fields a group needs to find its existing chief. */
  bots: () => Promise<readonly { id: string; group?: string; archived?: boolean }[]>;
  getBot: (id: string) => Promise<BotView>;
  createBot: (body: Record<string, unknown>) => Promise<BotView>;
  restoreBot: (id: string) => Promise<BotView>;
  /** The new bot's own skill files; the gateway's, or absent on a host that keeps none. */
  skills?: BotSkillFiles;
  readSettings: () => Promise<Settings>;
  writeSettings: (settings: Settings) => Promise<Settings>;
  /** Ensure every live Chief of Staff, including this one, has HUI's Heartbeat routine. */
  ensureHeartbeat?: () => Promise<unknown>;
};

function statusOf(error: unknown): number {
  if (error instanceof BotInputError) return 400;
  if (error instanceof BotNotFoundError) return 404;
  if (error instanceof BotConflictError) return 409;
  if (error instanceof BotWorkerOfflineError) return 503;
  return 500;
}

export function createStaffRoutes(deps: StaffRouteDeps) {
  async function handle(request: RouteRequest): Promise<RouteResult | undefined> {
    if (!ROUTE.test(request.path)) return undefined;
    if (request.method !== "POST") return { status: 405, body: { error: "method not allowed" } };
    try {
      const body: unknown = await request.json(16_384);
      if (typeof body !== "object" || body === null || Array.isArray(body)) throw new BotInputError("A chief needs { group, cwd }.");
      const input = body as Record<string, unknown>;
      const unknown = Object.keys(input).filter((key) => key !== "group" && key !== "cwd");
      if (unknown.length) throw new BotInputError(`Unknown chief field: ${unknown.join(", ")}.`);
      const group = (typeof input["group"] === "string" ? input["group"].replace(/\s+/gu, " ") : "").trim();
      const cwd = (typeof input["cwd"] === "string" ? input["cwd"] : "").trim();
      if (!group || group.length > 200 || CONTROL.test(group)) throw new BotInputError("group must be 1-200 characters, without control characters.");
      if (!cwd || cwd.length > 4_096 || CONTROL.test(cwd)) throw new BotInputError("cwd must be a project directory.");

      const existing = (await deps.bots()).find((bot) => bot.group === group);
      if (existing) {
        await deps.ensureHeartbeat?.().catch(() => undefined);
        return reply(BotResponse, { bot: existing.archived ? await deps.restoreBot(existing.id) : await deps.getBot(existing.id) });
      }

      const pack = await readStaffPack();
      const bot = await deps.createBot({
        name: `${pack.bot.name} · ${group}`,
        title: pack.bot.title,
        description: `${pack.bot.description} For the ${group} group.`,
        cwd,
        group,
        soul: pack.soul,
      });
      const skills = deps.skills ?? localBotSkills();
      await skills.write(bot.id, pack.skills.map((skill) => ({ name: skill.name, text: skill.text, ...(skill.files.length ? { files: skill.files } : {}) })));
      await deps.ensureHeartbeat?.().catch(() => undefined);

      // The routes are shared settings, so a group chief adds only what the installation does not have yet.
      const settings = await deps.readSettings();
      const names = new Set(settings.models.routes.map((route) => route.name));
      const missing = pack.routes.filter((route) => !names.has(route.name));
      if (missing.length) await deps.writeSettings({ ...settings, models: { ...settings.models, routes: [...settings.models.routes, ...missing] } });

      return reply(BotResponse, { bot }, 201);
    } catch (error) {
      return { status: statusOf(error), body: { error: error instanceof Error ? error.message : "The chief request failed." } };
    }
  }

  return { routeSchemas, handle };
}
