/**
 * `POST /__hui/staff/chiefs`: the Chief of Staff for one custom session group. The group's stored New session defaults
 * name the project directory and the machine its sessions run on; the chief runs on that machine and works in its own
 * folder, which HUI makes, with its own OptChat memory (every bot has one) and its own copy of the staff pack's skills
 * there. The project directory is where the sessions the chief creates run, not where its chat is.
 * Asking twice for the same group returns the chief it already has, restoring it if it was archived, so the group's menu
 * cannot create a second one.
 *
 * The pack is installed at creation: SOUL.md is the seed, and its skills are written into the new bot's own folder on
 * the host that keeps it (its worker's, or this gateway's). The routes are merged by name. HUI records what it installed
 * the next time the gateway starts (server/staff/service.ts), so the chief follows later pack updates; the operator can
 * edit its skills in Tools & skills, and the pack never overwrites an edited one.
 *
 * A new chief needs its group's project directory, because that is where the sessions it starts run: a group that names
 * none gets no chief, with the same sentence `create_session` and `sessions_spawn` use, as the New group dialog refuses
 * it. A group that already has its chief still answers it.
 */
import { BotConflictError, BotInputError, BotNotFoundError, BotWorkerOfflineError } from "../bots/bots.ts";
import type { BotSkillFiles } from "../bots/skills.ts";
import { GROUP_PROJECT_MISSING } from "../sessions/group-session-defaults.ts";
import { BotResponse, type BotView } from "../api/bots.ts";
import { routeSchemas } from "../api/staff.ts";
import type { Settings } from "../hui-settings.ts";
import { reply, type RouteRequest, type RouteResult } from "../http/route.ts";
import { readStaffPack } from "../staff/pack.ts";
import { sessionGroupName } from "./sessions.ts";

export { routeSchemas };

const ROUTE = /^\/__hui\/staff\/chiefs$/u;

export type StaffRouteDeps = {
  /** The configured session groups: the label the bot record carries, the machine its sessions and its chief run on,
   * and the project directory its chief's sessions belong to. Read from the registry, so a group's New session defaults
   * stay the one place they are stated. */
  groups: () => Promise<readonly { label: string; worker?: string; cwd?: string }[]>;
  /** The bot roster, by the fields a group needs to find its existing chief. */
  bots: () => Promise<readonly { id: string; group?: string; archived?: boolean }[]>;
  getBot: (id: string) => Promise<BotView>;
  createBot: (body: Record<string, unknown>) => Promise<BotView>;
  restoreBot: (id: string) => Promise<BotView>;
  /** The created bot's own skill files, by the bot just made: its worker's when its chat runs there, this gateway's
   * otherwise, and absent on a host that keeps none (there is nothing to write to). */
  skills: (bot: { id: string; worker?: { id: string } }) => BotSkillFiles | undefined;
  readSettings: () => Promise<Settings>;
  writeSettings: (settings: Settings) => Promise<Settings>;
  /** Records the pack as installed in the new chief, so a later start can tell its files from the operator's. */
  recordChief: (botId: string) => Promise<void>;
};

/** The group's label, normalised as the group routes normalise it, so a group named `Research  Lab` or typed with a tab
 * around it still finds its chief. */
function groupLabel(input: Record<string, unknown>): string {
  try {
    return sessionGroupName(input, "group");
  } catch (error) {
    throw new BotInputError(error instanceof Error ? error.message : "A chief needs { group }.");
  }
}

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
      if (typeof body !== "object" || body === null || Array.isArray(body)) throw new BotInputError("A chief needs { group }.");
      const input = body as Record<string, unknown>;
      const unknown = Object.keys(input).filter((key) => key !== "group");
      if (unknown.length) throw new BotInputError(`Unknown chief field: ${unknown.join(", ")}.`);
      const group = groupLabel(input);

      const configured = (await deps.groups()).find((candidate) => candidate.label === group);
      if (!configured) throw new BotInputError(`No session group named ${group}.`);

      const existing = (await deps.bots()).find((bot) => bot.group === group);
      if (existing) {
        return reply(BotResponse, { bot: existing.archived ? await deps.restoreBot(existing.id) : await deps.getBot(existing.id) });
      }

      // A chief works in its own folder, so its group's project directory is the only place its sessions can run: a group
      // that names none gets no new chief, as the New group dialog refuses one. An existing chief is still returned.
      if (!configured.cwd) throw new BotInputError(GROUP_PROJECT_MISSING);

      const pack = await readStaffPack();
      const bot = await deps.createBot({
        name: `${pack.bot.name} · ${group}`,
        title: pack.bot.title,
        description: `${pack.bot.description} For the ${group} group.`,
        group,
        ...(configured.worker ? { worker: configured.worker } : {}),
        soul: pack.soul,
      });
      // A chief on a worker keeps its home and skills there; a host that keeps none has nowhere to write them.
      const skills = deps.skills(bot);
      if (skills) await skills.write(bot.id, pack.skills.map((skill) => ({ name: skill.name, text: skill.text, ...(skill.files.length ? { files: skill.files } : {}) })));
      await deps.recordChief(bot.id);

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
