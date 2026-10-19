/**
 * The Worktrees page: `GET /__hui/worktrees` (the inventory), `POST /__hui/worktrees/remove` (one worktree or the
 * merged cleanup, over `worktree-inventory.ts`) and `GET /__hui/workspaces` (the workspace inspection).
 * `hui.ts` applies the `x-hui` guard before dispatching here.
 */
import { readWorkspaceInspection } from "../control-surfaces.ts";
import type { JsonResult, RouteRequest } from "../http/route.ts";
import type { SessionRecord } from "../sessions.ts";
import type { WorktreeService } from "../worktree-inventory.ts";
import type { WorktreeRisk } from "../../shared/worktrees.ts";

const WORKTREES_ROUTE = "/__hui/worktrees";
const WORKTREES_REMOVE_ROUTE = "/__hui/worktrees/remove";
const WORKSPACES_ROUTE = "/__hui/workspaces";

const WORKTREE_RISKS = new Set(["dirty", "unknown", "locked", "running", "missing", "external"]);

/** Validates `{ paths, mode, acknowledged? }` for worktree removal. */
export function parseWorktreeRemoval(body: unknown): { paths: string[]; mode: "single" | "merged"; acknowledged: WorktreeRisk[] } {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Removal request must be an object.");
  const record = body as Record<string, unknown>;
  const mode = record["mode"];
  if (mode !== "single" && mode !== "merged") throw new Error("mode must be single or merged.");
  const paths = record["paths"];
  if (!Array.isArray(paths) || paths.length === 0 || paths.length > 200
    || paths.some((path) => typeof path !== "string" || !path.startsWith("/") || path.length > 4096 || path.includes("\0"))) {
    throw new Error("paths must be 1-200 absolute paths.");
  }
  if (mode === "single" && paths.length !== 1) throw new Error("single removal takes exactly one path.");
  const acknowledged = record["acknowledged"] ?? [];
  if (!Array.isArray(acknowledged) || acknowledged.some((risk) => typeof risk !== "string" || !WORKTREE_RISKS.has(risk))) {
    throw new Error("acknowledged must list known worktree risks.");
  }
  if (mode === "merged" && acknowledged.length) throw new Error("merged cleanup never overrides risks.");
  return { paths: [...new Set(paths as string[])], mode, acknowledged: acknowledged as WorktreeRisk[] };
}

export function createWorktreeRoutes(deps: { worktreeService: WorktreeService; readRegistry(): Promise<SessionRecord[]> }) {
  async function handle(request: RouteRequest): Promise<JsonResult | undefined> {
    const { method, path } = request;
    const { worktreeService, readRegistry } = deps;
    if (path === WORKTREES_ROUTE) {
      if (method === "GET") return { status: 200, body: await worktreeService.inventory(await readRegistry()) };
      return { status: 405, body: { error: "method not allowed" } };
    }
    if (path === WORKTREES_REMOVE_ROUTE) {
      if (method !== "POST") return { status: 405, body: { error: "method not allowed" } };
      let removal: ReturnType<typeof parseWorktreeRemoval>;
      try {
        removal = parseWorktreeRemoval(await request.json());
      } catch (error) {
        return { status: 400, body: { error: error instanceof Error ? error.message : "Invalid removal request." } };
      }
      const results = await worktreeService.remove(await readRegistry(), removal.paths, removal.mode, removal.acknowledged);
      return { status: 200, body: { results, inventory: await worktreeService.inventory(await readRegistry()) } };
    }
    if (path === WORKSPACES_ROUTE) {
      if (method === "GET") return { status: 200, body: await readWorkspaceInspection() };
      return { status: 405, body: { error: "method not allowed" } };
    }
    return undefined;
  }

  return { handle };
}
