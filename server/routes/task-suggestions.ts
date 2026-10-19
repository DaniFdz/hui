/**
 * `/__hui/sessions/:id/suggestions/:sid…`: dismiss, start or save a session's pending task suggestion to the
 * backlog. `hui.ts` supplies the lifecycle and applies the `x-hui` guard before dispatching here.
 */
import type { JsonResult, RouteRequest } from "../http/route.ts";
import type { createBacklogLifecycle } from "../backlog.ts";
import { SessionBusyError } from "../live-sessions.ts";
import type { readRegistry } from "../sessions.ts";
import { TaskSuggestionInputError, TaskSuggestionNotFoundError, type TaskSuggestionStore } from "../task-suggestions.ts";
import { backlogErrorStatus } from "./backlog.ts";

const SESSION_SUGGESTION = /^\/__hui\/sessions\/([^/]+)\/suggestions\/([^/]+?)(?:\/(start|backlog))?$/;

type SuggestionLifecycle = Pick<ReturnType<typeof createBacklogLifecycle>, "startTaskSuggestion" | "saveSuggestionToBacklog">;
type TaskSuggestionStartMode = NonNullable<Parameters<SuggestionLifecycle["startTaskSuggestion"]>[2]>;
type TaskSuggestionRouteDeps = SuggestionLifecycle & {
  taskSuggestions: TaskSuggestionStore;
  readRegistry: typeof readRegistry;
  sessionMutationErrorStatus(error: unknown): 400 | 500;
  TASK_SUGGESTION_START_MODES: readonly TaskSuggestionStartMode[];
};

export function createTaskSuggestionRoutes(deps: TaskSuggestionRouteDeps) {
  async function handle(request: RouteRequest): Promise<JsonResult | undefined> {
    const { path } = request;
    const { taskSuggestions, readRegistry, startTaskSuggestion, saveSuggestionToBacklog, sessionMutationErrorStatus, TASK_SUGGESTION_START_MODES } = deps;
    const suggestionRoute = path.match(SESSION_SUGGESTION);
    if (suggestionRoute) {
      const starting = suggestionRoute[3] === "start";
      const saving = suggestionRoute[3] === "backlog";
      if (request.method !== (starting || saving ? "POST" : "DELETE")) {
        return { status: 405, body: { error: "method not allowed" } };
      }
      const id = decodeURIComponent(suggestionRoute[1] ?? "");
      const suggestionId = decodeURIComponent(suggestionRoute[2] ?? "");
      const source = (await readRegistry()).find((session) => session.id === id);
      if (!source) {
        return { status: 404, body: { error: `unknown session: ${id}` } };
      }
      if (saving) {
        try {
          const task = await saveSuggestionToBacklog(id, suggestionId);
          return { status: 200, body: { taskId: `local:${task.id}`, suggestions: taskSuggestions.list(id) } };
        } catch (error) {
          return { status: backlogErrorStatus(error), body: {
            error: error instanceof Error ? error.message : "Could not add that suggestion to the backlog.",
          } };
        }
      }
      if (starting) {
        try {
          const body = (await request.json()) as Record<string, unknown>;
          const mode = body["mode"] ?? "session";
          if (typeof mode !== "string" || !TASK_SUGGESTION_START_MODES.includes(mode as TaskSuggestionStartMode)) {
            throw new TaskSuggestionInputError("mode must be session, worktree or current.");
          }
          const session = await startTaskSuggestion(source, suggestionId, mode as TaskSuggestionStartMode);
          return { status: 200, body: { session, suggestions: taskSuggestions.list(id) } };
        } catch (error) {
          return { status: error instanceof TaskSuggestionNotFoundError ? 404 : error instanceof SessionBusyError ? 409 : sessionMutationErrorStatus(error), body: {
            error: error instanceof Error ? error.message : "Could not start that suggestion.",
          } };
        }
      }
      try {
        taskSuggestions.remove(id, suggestionId);
        return { status: 200, body: { suggestions: taskSuggestions.list(id) } };
      } catch (error) {
        return { status: error instanceof TaskSuggestionNotFoundError ? 404 : 400, body: {
          error: error instanceof Error ? error.message : "Could not dismiss that suggestion.",
        } };
      }
    }
    return undefined;
  }

  return { handle };
}
