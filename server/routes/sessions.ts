/**
 * The session list and its groups: `/__hui/session-groups` (create, reorder) and `/__hui/session-groups/:label`
 * (rename or change defaults, delete), `GET/POST /__hui/sessions` (the list, a new session or a worktree launch) and
 * `PATCH/DELETE /__hui/sessions/:id` (change or remove one session), over `sessions.ts` and `sessions/lifecycle.ts`.
 * `hui.ts` applies the `x-hui` guard before dispatching here and keeps the `/__hui/sessions/events` stream.
 */
import { stat } from "node:fs/promises";
import type { BotService } from "../bot-service.ts";
import type { JsonResult, RouteRequest } from "../http/route.ts";
import { liveSessions } from "../live-sessions.ts";
import {
  createSessionGroup,
  deleteSessionGroup,
  readRegistry,
  reorderSessionGroups,
  SessionNotFoundError,
  SessionRegistryError,
  type SessionRecord,
  updateSessionGroup,
} from "../sessions.ts";
import { type createSessionLifecycle, SESSION_GROUP_MAX, SESSION_TITLE_MAX, sessionText } from "../sessions/lifecycle.ts";
import { type createSessionViews, pendingSessions } from "../sessions/views.ts";
import { resolveWorkingDirectory } from "../working-directories.ts";
import { BOTS_OFF_MESSAGE } from "../../shared/bots.ts";

const SESSIONS_ROUTE = "/__hui/sessions";
const SESSION_GROUPS_ROUTE = "/__hui/session-groups";
const SESSION_GROUP_ONE = /^\/__hui\/session-groups\/([^/]+)$/;
const SESSION_GROUP_ORDER_MAX = 1_000;
/** The session itself, for changing it rather than acting on it. */
const SESSION_ONE = /^\/__hui\/sessions\/([^/]+)$/;

/** Prompts may carry images inline, so they get their own, larger ceiling. */
export const MAX_PROMPT_BYTES = 24 * 1024 * 1024;

/** Why a bot's chat refuses an operation that would end, shorten or fork it (409). Without a handle (an unreadable
 * bot registry), the record's `bot` field alone refuses. */
export function foreverChatRefusal(handle: string | undefined, operation: "clear" | "compact" | "rewind" | "fork" | "delete"): string {
  const chat = handle ? `@${handle}'s` : "a bot's";
  return {
    clear: `This is ${chat} forever chat: it cannot be cleared. Its memory keeps everything; archive the bot when you are done with it.`,
    compact: `This is ${chat} forever chat: its memory condenses it by itself, so it is not compacted by hand.`,
    rewind: `This is ${chat} forever chat: it cannot be rewound or forked.`,
    fork: `This is ${chat} forever chat: it cannot be rewound or forked.`,
    delete: `This is ${chat} forever chat: archive the bot instead${handle ? ` (hui bot remove ${handle})` : ""}, which keeps its chat and memory, or delete the bot${handle ? ` (hui bot delete ${handle})` : ""} with its chat, memory and folder.`,
  }[operation];
}

function sessionGroupName(body: Record<string, unknown>, key = "name"): string {
  if (typeof body[key] !== "string") throw new Error("A group name is required.");
  const value = body[key].trim();
  if (!value || value.length > SESSION_GROUP_MAX) {
    throw new Error(`A group name must be 1-${SESSION_GROUP_MAX} characters.`);
  }
  if (value.toLocaleLowerCase() === "ungrouped") {
    throw new Error('"ungrouped" is reserved for sessions without a group.');
  }
  return value;
}

/** The complete catalog order; registry validation rejects stale lists. */
function sessionGroupOrder(body: Record<string, unknown>): string[] {
  const order = body["order"];
  if (!Array.isArray(order) || order.length > SESSION_GROUP_ORDER_MAX) {
    throw new Error(`A group order must list at most ${SESSION_GROUP_ORDER_MAX} groups.`);
  }
  return order.map((label) => {
    if (typeof label !== "string" || !label || label.length > SESSION_GROUP_MAX) {
      throw new Error(`Group names must be 1-${SESSION_GROUP_MAX} characters.`);
    }
    return label;
  });
}

export async function sessionGroupPatch(body: Record<string, unknown>): Promise<{
  label?: string;
  cwd?: string;
  workspaceMode?: "branch" | "worktree" | "";
  baseRef?: string;
}> {
  const patch: { label?: string; cwd?: string; workspaceMode?: "branch" | "worktree" | ""; baseRef?: string } = {};
  if ("name" in body) patch.label = sessionGroupName(body);
  if ("cwd" in body) {
    if (typeof body["cwd"] !== "string") throw new Error("Working directory must be text.");
    const entered = body["cwd"].trim();
    const cwd = entered ? resolveWorkingDirectory(entered) : "";
    if (cwd) {
      let info;
      try {
        info = await stat(cwd);
      } catch {
        throw new Error(`No such directory: ${cwd}`);
      }
      if (!info.isDirectory()) throw new Error(`Not a directory: ${cwd}`);
    }
    patch.cwd = cwd;
  }
  if ("workspaceMode" in body) {
    const mode = body["workspaceMode"];
    if (mode !== "" && mode !== "branch" && mode !== "worktree") throw new Error("Environment must be branch or worktree.");
    patch.workspaceMode = mode;
  }
  if ("baseRef" in body) patch.baseRef = sessionText(body, "baseRef", SESSION_TITLE_MAX, { optional: false, allowEmpty: true })!;
  if (Object.keys(patch).length === 0) throw new Error("Nothing to change.");
  return patch;
}

/** Input/import-source failures are client-visible 400s; registry integrity or
 * storage failures are backend failures and must never be misreported as bad
 * user input. */
export function sessionMutationErrorStatus(error: unknown): 400 | 500 {
  return error instanceof SessionRegistryError ? 500 : 400;
}

export function createSessionRoutes(deps: {
  sessionList: { refresh(): Promise<unknown> };
  lifecycle: Pick<ReturnType<typeof createSessionLifecycle>, "createSession" | "startWorktreeSession" | "deleteSession" | "updateSession">;
  views: Pick<ReturnType<typeof createSessionViews>, "toView">;
  bots: Pick<BotService, "botForSession">;
  isDormantBotChat(record: SessionRecord): Promise<boolean>;
}) {
  async function handle(request: RouteRequest): Promise<JsonResult | undefined> {
    const { method, path } = request;
    const { sessionList, bots, isDormantBotChat } = deps;
    const { createSession, startWorktreeSession, deleteSession, updateSession } = deps.lifecycle;
    const { toView } = deps.views;

    if (path === SESSION_GROUPS_ROUTE && method === "POST") {
      try {
        const body = (await request.json()) as Record<string, unknown>;
        await createSessionGroup(sessionGroupName(body));
        return { status: 200, body: await sessionList.refresh() };
      } catch (error) {
        return { status: sessionMutationErrorStatus(error), body: {
          error: error instanceof Error ? error.message : "Could not create that group.",
        } };
      }
    }

    if (path === SESSION_GROUPS_ROUTE && method === "PUT") {
      try {
        const body = (await request.json()) as Record<string, unknown>;
        await reorderSessionGroups(sessionGroupOrder(body));
        return { status: 200, body: await sessionList.refresh() };
      } catch (error) {
        return { status: sessionMutationErrorStatus(error), body: {
          error: error instanceof Error ? error.message : "Could not reorder the groups.",
        } };
      }
    }

    const groupOne = path.match(SESSION_GROUP_ONE);
    if (groupOne && (method === "PATCH" || method === "DELETE")) {
      const label = decodeURIComponent(groupOne[1] ?? "");
      try {
        if (method === "DELETE") {
          await deleteSessionGroup(label);
        } else {
          await updateSessionGroup(
            label,
            await sessionGroupPatch((await request.json()) as Record<string, unknown>),
          );
        }
        return { status: 200, body: await sessionList.refresh() };
      } catch (error) {
        return { status: sessionMutationErrorStatus(error), body: {
          error: error instanceof Error ? error.message : "Could not update that group.",
        } };
      }
    }

    if (path === SESSIONS_ROUTE) {
      if (method === "GET") {
        return { status: 200, body: await sessionList.refresh() };
      }
      if (method === "POST") {
        let body: Record<string, unknown>;
        try {
          // A worktree launch may carry its first prompt's attachments.
          body = (await request.json(MAX_PROMPT_BYTES)) as Record<string, unknown>;
        } catch (error) {
          return { status: sessionMutationErrorStatus(error), body: {
            error: error instanceof Error ? error.message : "Could not read that session request.",
          } };
        }
        if (body["worktree"] === true) {
          try {
            return { status: 200, body: { session: await startWorktreeSession(body) } };
          } catch (error) {
            return { status: sessionMutationErrorStatus(error), body: {
              error: error instanceof Error ? error.message : "Could not start that session.",
            } };
          }
        }
        try {
          const record = await createSession(body);
          return { status: 200, body: { session: toView(record, liveSessions.status(record.id)) } };
        } catch (error) {
          return { status: sessionMutationErrorStatus(error), body: {
            error: error instanceof Error ? error.message : "Could not start that session.",
          } };
        }
      }
      return { status: 405, body: { error: "method not allowed" } };
    }

    const one = path.match(SESSION_ONE);
    if (one && (method === "PATCH" || method === "DELETE")) {
      const id = decodeURIComponent(one[1] ?? "");

      const pending = pendingSessions.get(id);
      if (pending) {
        if (method === "DELETE" && pending.error) {
          pendingSessions.delete(id);
          return { status: 200, body: { ok: true } };
        }
        return { status: 409, body: { error: pending.error ?? "The Git worktree is still being created." } };
      }

      const owned = (await readRegistry()).find((session) => session.id === id);
      if (owned && await isDormantBotChat(owned)) {
        return { status: 409, body: { error: BOTS_OFF_MESSAGE } };
      }

      if (method === "DELETE") {
        // A bot owns its chat: deleting the row would orphan the bot. Archiving keeps both.
        const bot = await bots.botForSession(id).catch(() => undefined);
        if (bot) {
          return { status: 409, body: { error: foreverChatRefusal(bot.handle, "delete") } };
        }
        // Block stale opens first, but keep the runtime and streams alive until
        // registry removal commits. A storage failure rolls the tombstone back.
        try {
          await deleteSession(id);
        } catch (error) {
          return { status: error instanceof SessionNotFoundError ? 404 : 500, body: {
            error: error instanceof Error ? error.message : "Could not remove that session.",
          } };
        }
        // The conversation file under ~/.pi is pi's and is deliberately left
        // alone; losing a transcript because you tidied a list is unforgivable.
        return { status: 200, body: { ok: true } };
      }

      const body = (await request.json()) as Record<string, unknown>;
      try {
        const next = await updateSession(id, body);
        return { status: 200, body: { session: toView(next, liveSessions.status(id)) } };
      } catch (error) {
        return {
          status: error instanceof SessionNotFoundError
            ? 404
            : error instanceof SessionRegistryError
              ? 500
              : 400,
          body: { error: error instanceof Error ? error.message : "Could not update that session." },
        };
      }
    }

    return undefined;
  }

  return { handle };
}
