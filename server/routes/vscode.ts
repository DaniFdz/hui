/**
 * The VS Code view's guarded routes: `POST /__hui/sessions/:id/vscode/connect` (starts the shared server on the
 * conversation's folder and mints the frame's one-use ticket) and `GET/POST /__hui/vscode-server` (the server's
 * status, install, license and stop actions, over `vscode.ts`). The ticket's enter path and the cookie-guarded proxy
 * stay ahead of the `x-hui` guard in `hui.ts` (`vscode-proxy.ts`); `hui.ts` applies that guard before dispatching here.
 */
import { stat } from "node:fs/promises";
import type { JsonResult, RouteRequest } from "../http/route.ts";
import type { SessionRecord } from "../sessions.ts";
import { VscodeError, type VscodeService } from "../vscode.ts";
import { normalizeVscodeTheme, VSCODE_ACTIONS, VSCODE_STATUS_ROUTE, type VscodeAction } from "../../shared/vscode.ts";

const VSCODE_CONNECT_ROUTE = /^\/__hui\/sessions\/([^/]+)\/vscode\/connect$/u;

export function createVscodeRoutes(deps: { vscode: VscodeService; readRegistry(): Promise<SessionRecord[]> }) {
  async function handle(request: RouteRequest): Promise<JsonResult | undefined> {
    const { vscode } = deps;
    const vscodeRoute = request.path.match(VSCODE_CONNECT_ROUTE);
    if (vscodeRoute) {
      try {
        if (request.method !== "POST") throw new VscodeError("Method not allowed.", 405);
        let body: unknown;
        try { body = await request.json(); } catch { throw new VscodeError("VS Code request body must be JSON.", 400); }
        const owner = decodeURIComponent(vscodeRoute[1] ?? "");
        const session = (await deps.readRegistry()).find((record) => record.id === owner);
        if (!session) throw new VscodeError("Conversation not found.", 404);
        if (session.worker) throw new VscodeError("This conversation runs on a remote worker. VS Code runs on the gateway's machine, which does not have its files.", 409, "remote");
        const folder = await stat(session.cwd).then((info) => info.isDirectory(), () => false);
        if (!folder) throw new VscodeError(`The conversation's folder no longer exists: ${session.cwd}`, 409, "folder");
        const theme = body && typeof body === "object" && !Array.isArray(body) ? normalizeVscodeTheme((body as Record<string, unknown>)["theme"]) : undefined;
        const connection = await vscode.connect(session.cwd, theme);
        // Still starting (serve-web downloading its first build): the view follows the status and asks again.
        if ("pending" in connection) return { status: 202, body: { pending: true, status: await vscode.status() } };
        return { status: 200, body: connection };
      } catch (error) {
        return {
          status: error instanceof VscodeError ? error.status : 500,
          body: { error: error instanceof Error ? error.message : "VS Code could not open.", code: error instanceof VscodeError ? error.code : "failed" },
        };
      }
    }
    if (request.path === VSCODE_STATUS_ROUTE) {
      try {
        if (request.method === "GET") return { status: 200, body: await vscode.status() };
        if (request.method !== "POST") throw new VscodeError("Method not allowed.", 405);
        let body: unknown;
        try { body = await request.json(); } catch { throw new VscodeError("VS Code request body must be JSON.", 400); }
        const action = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>)["action"] : undefined;
        if (!VSCODE_ACTIONS.includes(action as VscodeAction)) throw new VscodeError(`action must be one of ${VSCODE_ACTIONS.join(", ")}.`, 400);
        switch (action as VscodeAction) {
          case "stop": await vscode.stop(); break;
          case "accept-license": await vscode.acceptLicense(); break;
          case "revoke-license": await vscode.revokeLicense(); break;
          case "install": vscode.startInstall(); break;
          case "cancel-install": await vscode.cancelInstall(); break;
          case "uninstall": await vscode.uninstall(); break;
        }
        return { status: 200, body: await vscode.status() };
      } catch (error) {
        return {
          status: error instanceof VscodeError ? error.status : 500,
          body: { error: error instanceof Error ? error.message : "The VS Code request failed.", code: error instanceof VscodeError ? error.code : "failed" },
        };
      }
    }
    return undefined;
  }

  return { handle };
}
