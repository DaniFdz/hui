/**
 * Browser client for the VS Code view: the gateway's VS Code status (what can run here, what a first open must ask,
 * an install's progress), its actions (accept or revoke the VS Code Server license, install or remove
 * openvscode-server, stop), the one-use frame URL for a conversation's folder, and HUI's colors read from its tokens
 * so VS Code can wear them. The gateway runs and guards the server (server/vscode.ts).
 */
import { CLIENT_HEADERS, fetchJson, refreshSettings } from "./settings-store.ts";
import { fetchWithResponseDeadline } from "./gateway-request.ts";
import { trackedFetch } from "./ui-errors.ts";
import {
  VSCODE_STATUS_ROUTE,
  type VscodeAction, type VscodeConnection, type VscodeErrorCode, type VscodeStatus, type VscodeTheme,
} from "../../shared/vscode.ts";

let known: VscodeStatus | undefined;
const listeners = new Set<(status: VscodeStatus) => void>();

function remember(status: VscodeStatus): VscodeStatus {
  known = status;
  for (const listener of listeners) listener(status);
  return status;
}

/** The last status any screen loaded; undefined before the first. */
export function knownVscodeStatus(): VscodeStatus | undefined {
  return known;
}

export function onVscodeStatus(listener: (status: VscodeStatus) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function loadVscodeStatus(): Promise<VscodeStatus> {
  return remember(await fetchJson<VscodeStatus>(VSCODE_STATUS_ROUTE));
}

/** One of the gateway's VS Code actions; the license ones change HUI's settings, which this screen then re-reads. */
export async function vscodeAction(action: VscodeAction): Promise<VscodeStatus> {
  const status = remember(await fetchJson<VscodeStatus>(VSCODE_STATUS_ROUTE, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }),
  }));
  if (action === "accept-license" || action === "revoke-license") await refreshSettings();
  return status;
}

export function stopVscode(): Promise<VscodeStatus> {
  return vscodeAction("stop");
}

/** A refusal with the gateway's reason and what kind it is, so the view can show its setup card or explain the
 * conversation. */
export class VscodeConnectError extends Error {
  code: VscodeErrorCode;
  status: number;
  constructor(message: string, code: VscodeErrorCode, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const ERROR_CODES = new Set<VscodeErrorCode>(["setup", "remote", "folder", "failed", "busy"]);

/** Starts the shared server if needed and returns a one-use frame URL on the conversation's folder, or the status
 * while it is still starting (serve-web's first start downloads Microsoft's server build). */
export async function connectVscode(sessionId: string, theme: VscodeTheme | undefined): Promise<VscodeConnection | { pending: VscodeStatus }> {
  const response = await fetchWithResponseDeadline(trackedFetch, `/__hui/sessions/${encodeURIComponent(sessionId)}/vscode/connect`, {
    method: "POST",
    headers: { ...CLIENT_HEADERS, "content-type": "application/json" },
    body: JSON.stringify(theme ? { theme } : {}),
    cache: "no-store",
  });
  const body = (await response.json().catch(() => undefined)) as (Partial<VscodeConnection> & { error?: string; code?: string; pending?: boolean; status?: VscodeStatus }) | undefined;
  if (response.status === 202 && body?.pending && body.status) return { pending: remember(body.status) };
  if (!response.ok || typeof body?.url !== "string") {
    const code = ERROR_CODES.has(body?.code as VscodeErrorCode) ? body?.code as VscodeErrorCode : "failed";
    throw new VscodeConnectError(body?.error ?? `VS Code could not open (HTTP ${response.status}).`, code, response.status);
  }
  const folder = String(body.folder ?? "");
  return { url: body.url, folder, label: String(body.label ?? folder), instance: Number(body.instance ?? 0) };
}

/** HUI's tokens as #rrggbb, whatever color syntax the theme uses: a 1×1 canvas converts and composites them. */
export function readVscodeTheme(root: Element = document.documentElement): VscodeTheme | undefined {
  const style = getComputedStyle(root);
  const context = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  if (!context) return undefined;
  const hex = (name: string, over?: string): string | undefined => {
    const value = style.getPropertyValue(name).trim();
    if (!value) return undefined;
    context.clearRect(0, 0, 1, 1);
    if (over) { context.fillStyle = over; context.fillRect(0, 0, 1, 1); }
    context.fillStyle = "#000000";
    context.fillStyle = value;
    context.fillRect(0, 0, 1, 1);
    const [r = 0, g = 0, b = 0] = context.getImageData(0, 0, 1, 1).data;
    return `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
  };
  const background = hex("--bg");
  if (!background) return undefined;
  const panel = hex("--panel", background) ?? background;
  const elevated = hex("--bg-elevated", background) ?? panel;
  const text = hex("--text", background);
  if (!text) return undefined;
  const border = hex("--border", background);
  const accent = hex("--accent", background);
  return { background, panel, elevated, text, ...(border ? { border } : {}), ...(accent ? { accent } : {}) };
}
