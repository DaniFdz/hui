/**
 * `/__hui/automation…`: scheduled tasks, their runs and cancellation over `automation.ts`. `hui.ts` applies the
 * `x-hui` guard before dispatching here.
 */
import type { JsonResult, RouteRequest } from "../http/route.ts";
import {
  AutomationConflictError,
  AutomationInputError,
  AutomationNotFoundError,
  type AutomationService,
} from "../automation.ts";

export const AUTOMATION_ROUTE = "/__hui/automation";
const AUTOMATION_TASKS_ROUTE = `${AUTOMATION_ROUTE}/tasks`;
const AUTOMATION_TASK_ONE = /^\/__hui\/automation\/tasks\/([^/]+)$/;
const AUTOMATION_TASK_RUN = /^\/__hui\/automation\/tasks\/([^/]+)\/run$/;
const AUTOMATION_RUN_CANCEL = /^\/__hui\/automation\/runs\/([^/]+)\/cancel$/;

function automationErrorStatus(error: unknown): 400 | 404 | 409 | 500 {
  if (error instanceof AutomationNotFoundError) return 404;
  if (error instanceof AutomationConflictError) return 409;
  if (error instanceof AutomationInputError) return 400;
  return 500;
}

export function createAutomationRoutes(deps: { automation: AutomationService }) {
  async function handle(request: RouteRequest): Promise<JsonResult | undefined> {
    const { path } = request;
    const { automation } = deps;
    if (path === AUTOMATION_ROUTE && request.method === "GET") {
      try {
        return { status: 200, body: await automation.snapshot() };
      } catch (error) {
        return { status: 500, body: {
          error: error instanceof Error ? error.message : "Could not read automation state.",
        } };
      }
    }

    if (path === AUTOMATION_TASKS_ROUTE && request.method === "POST") {
      try {
        const task = await automation.create(await request.json());
        return { status: 201, body: { task, snapshot: await automation.snapshot() } };
      } catch (error) {
        return { status: automationErrorStatus(error), body: {
          error: error instanceof Error ? error.message : "Could not create that task.",
        } };
      }
    }

    const automationTask = path.match(AUTOMATION_TASK_ONE);
    if (automationTask && (request.method === "PUT" || request.method === "DELETE")) {
      const id = decodeURIComponent(automationTask[1] ?? "");
      try {
        if (request.method === "DELETE") await automation.remove(id);
        else await automation.update(id, await request.json());
        return { status: 200, body: { snapshot: await automation.snapshot() } };
      } catch (error) {
        return { status: automationErrorStatus(error), body: {
          error: error instanceof Error ? error.message : "Could not update that task.",
        } };
      }
    }

    const automationRun = path.match(AUTOMATION_TASK_RUN);
    if (automationRun && request.method === "POST") {
      try {
        const run = await automation.run(decodeURIComponent(automationRun[1] ?? ""));
        return { status: 202, body: { run } };
      } catch (error) {
        return { status: automationErrorStatus(error), body: {
          error: error instanceof Error ? error.message : "Could not run that task.",
        } };
      }
    }

    const automationCancel = path.match(AUTOMATION_RUN_CANCEL);
    if (automationCancel && request.method === "POST") {
      try {
        await automation.cancel(decodeURIComponent(automationCancel[1] ?? ""));
        return { status: 200, body: { ok: true } };
      } catch (error) {
        return { status: automationErrorStatus(error), body: {
          error: error instanceof Error ? error.message : "Could not cancel that run.",
        } };
      }
    }
    return undefined;
  }

  return { handle };
}
