/**
 * Local path lookups for the launcher and the composer: `GET /__hui/directories` (working directory suggestions,
 * from a worker when one is named), `GET /__hui/local-paths` (path completion under a working directory) and
 * `GET /__hui/git-checkout` (what Git checkout a folder is). `hui.ts` applies the `x-hui` guard before dispatching
 * here.
 */
import type { JsonResult, RouteRequest } from "../http/route.ts";
import { completeLocalPaths, completeWorkingDirectories, resolveWorkingDirectory } from "../working-directories.ts";
import type { WorkerService } from "../workers.ts";
import { inspectGitCheckout } from "../worktrees.ts";

const DIRECTORIES_ROUTE = "/__hui/directories";
const LOCAL_PATHS_ROUTE = "/__hui/local-paths";
const GIT_CHECKOUT_ROUTE = "/__hui/git-checkout";

export function createLocalPathRoutes(deps: { workers: WorkerService }) {
  async function handle(request: RouteRequest): Promise<JsonResult | undefined> {
    const { method, path } = request;
    if (path === DIRECTORIES_ROUTE) {
      if (method === "GET") {
        const query = request.query.get("q") ?? "~/";
        const worker = request.query.get("worker");
        // An unreachable worker just offers no suggestions; launching reports why.
        const directories = worker ? await deps.workers.directories(worker, query).catch(() => []) : await completeWorkingDirectories(query);
        return { status: 200, body: { directories } };
      }
      return { status: 405, body: { error: "method not allowed" } };
    }
    if (path === LOCAL_PATHS_ROUTE) {
      if (method === "GET") {
        const input = request.query.get("q") ?? "";
        const cwd = request.query.get("cwd") ?? "~/";
        if (input.length > 4_096 || cwd.length > 4_096) return { status: 400, body: { error: "path query is too long" } };
        return { status: 200, body: { paths: await completeLocalPaths(input, resolveWorkingDirectory(cwd)) } };
      }
      return { status: 405, body: { error: "method not allowed" } };
    }
    if (path === GIT_CHECKOUT_ROUTE) {
      if (method === "GET") {
        const query = request.query.get("cwd") ?? "~/";
        return { status: 200, body: { checkout: await inspectGitCheckout(resolveWorkingDirectory(query)) } };
      }
      return { status: 405, body: { error: "method not allowed" } };
    }
    return undefined;
  }

  return { handle };
}
