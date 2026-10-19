/**
 * PI's configuration as HUI shows it: `GET /__hui/pi` (the refreshed view), package install and remove and skill
 * install (`pi-mutations.ts`, which delegates to PI's own CLI or a short-lived PI installer agent, so PI remains the
 * writer), `GET /__hui/tools` and `GET /__hui/pi/resources/:kind/:id` (a skill's or plugin's document). `hui.ts`
 * applies the `x-hui` guard before dispatching here.
 */
import type { JsonResult, RouteRequest } from "../http/route.ts";
import { readPiConfig } from "../pi-config.ts";
import {
  PiMutationBusyError,
  PiMutationCommandError,
  PiMutationInputError,
  type PiMutationService,
} from "../pi-mutations.ts";
import { PiResourceNotFoundError, readPiResourceDocument } from "../pi-resource-reader.ts";
import { readToolsCatalog } from "../tools.ts";

const PI_ROUTE = "/__hui/pi";
const PI_PACKAGE_INSTALL_ROUTE = `${PI_ROUTE}/packages/install`;
const PI_PACKAGE_REMOVE_ROUTE = `${PI_ROUTE}/packages/remove`;
const PI_SKILL_INSTALL_ROUTE = `${PI_ROUTE}/skills/install`;
const PI_RESOURCE_READ_ROUTE = /^\/__hui\/pi\/resources\/(skill|plugin)\/([a-f0-9]{24})$/;
const TOOLS_ROUTE = "/__hui/tools";

export function createPiRoutes(deps: { piMutations: PiMutationService }) {
  async function handle(request: RouteRequest): Promise<JsonResult | undefined> {
    const { method, path } = request;
    if (path === PI_PACKAGE_INSTALL_ROUTE || path === PI_PACKAGE_REMOVE_ROUTE || path === PI_SKILL_INSTALL_ROUTE) {
      if (method !== "POST") return { status: 405, body: { error: "method not allowed" } };
      try {
        const body = (await request.json()) as Record<string, unknown>;
        const result = path === PI_PACKAGE_INSTALL_ROUTE
          ? await deps.piMutations.installPackage(typeof body["url"] === "string" ? body["url"] : "")
          : path === PI_PACKAGE_REMOVE_ROUTE
            ? await deps.piMutations.removePackage(typeof body["source"] === "string" ? body["source"] : "")
            : await deps.piMutations.installSkill(typeof body["url"] === "string" ? body["url"] : "");
        return { status: 200, body: result };
      } catch (error) {
        const status = error instanceof PiMutationBusyError
          ? 409
          : error instanceof PiMutationInputError
            ? 400
            : error instanceof PiMutationCommandError
              ? 502
              : 500;
        return { status, body: { error: error instanceof Error ? error.message : "PI operation failed." } };
      }
    }
    if (path === TOOLS_ROUTE) {
      if (method === "GET") return { status: 200, body: await readToolsCatalog() };
      return { status: 405, body: { error: "method not allowed" } };
    }
    const resourceRead = path.match(PI_RESOURCE_READ_ROUTE);
    if (resourceRead) {
      if (method !== "GET") return { status: 405, body: { error: "method not allowed" } };
      try {
        return { status: 200, body: await readPiResourceDocument(resourceRead[1] as "skill" | "plugin", resourceRead[2] ?? "") };
      } catch (error) {
        return {
          status: error instanceof PiResourceNotFoundError ? 404 : 500,
          body: { error: error instanceof Error ? error.message : "Could not read the resource." },
        };
      }
    }
    if (path === PI_ROUTE) {
      if (method === "GET") return { status: 200, body: await readPiConfig() };
      return { status: 405, body: { error: "method not allowed" } };
    }
    return undefined;
  }

  return { handle };
}
