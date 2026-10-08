/**
 * The VS Code view's contract between the gateway and the browser: its routes, the status the gateway reports,
 * the HUI colors a frame asks VS Code to wear, and the one sentence that says why the view cannot open. Running
 * openvscode-server is server/vscode.ts's job; the frame is src/components/vscode-view.ts.
 */

/** openvscode-server's `--server-base-path`: every workbench URL and its WebSocket live under it. */
export const VSCODE_BASE_PATH = "/__hui/vscode";
/** A frame's first load: trades a one-use ticket for the proxy's cookie, then redirects to the folder. */
export const VSCODE_ENTER_PATH = `${VSCODE_BASE_PATH}/enter`;
/** HUI's own guarded JSON route: the status (GET) and stopping the server (POST `{ action: "stop" }`). */
export const VSCODE_STATUS_ROUTE = "/__hui/vscode-server";

/** `off`: Settings → Tools → VS Code is off. `unavailable`: no compatible executable. The rest is the process. */
export type VscodeState = "off" | "unavailable" | "stopped" | "starting" | "running" | "failed";

export type VscodeExecutableInfo = {
  path: string;
  /** Product name from its `--help` banner, such as "OpenVSCode Server". */
  name: string;
  version: string;
  source: "configured" | "detected";
};

export type VscodeStatus = {
  enabled: boolean;
  /** The path saved in Settings; empty auto-detects. */
  configuredExecutable: string;
  executable: VscodeExecutableInfo | null;
  /** Why no executable can be used, as visible text; empty when one can. */
  executableError: string;
  state: VscodeState;
  /** Counts server starts in this gateway run; a frame opened on an earlier instance knows it stopped. */
  instance: number;
  pid?: number;
  startedAt?: string;
  /** Why the last start failed or the process exited. */
  lastError: string;
  /** Proxied HTTP requests and WebSockets open now. */
  connections: number;
  /** The server stops this long after its last connection closes. */
  idleMinutes: number;
  /** Where VS Code keeps its settings, extensions and state. */
  dataDir: string;
};

/** Refusals the browser distinguishes: the first two point at Settings, the next two at the conversation. */
export type VscodeErrorCode = "disabled" | "not-found" | "remote" | "folder" | "failed" | "busy";

export type VscodeConnection = {
  /** A one-use `/__hui/vscode/enter?ticket=…` URL, valid for 30 seconds. */
  url: string;
  folder: string;
  /** The folder with the gateway user's home shown as `~`. */
  label: string;
  instance: number;
};

/** HUI's palette as #rrggbb, read from its tokens by the browser and mapped onto VS Code's colors by the gateway. */
export type VscodeTheme = {
  background: string;
  panel: string;
  elevated: string;
  text: string;
  border?: string;
  accent?: string;
};

const THEME_KEYS = ["background", "panel", "elevated", "text", "border", "accent"] as const;
const HEX = /^#[0-9a-f]{6}$/iu;

/** Only #rrggbb values pass: anything else could reach VS Code's settings. The four base colors are required. */
export function normalizeVscodeTheme(value: unknown): VscodeTheme | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  const colors: Partial<Record<(typeof THEME_KEYS)[number], string>> = {};
  for (const key of THEME_KEYS) {
    const color = source[key];
    if (typeof color === "string" && HEX.test(color.trim())) colors[key] = color.trim().toLowerCase();
  }
  const { background, panel, elevated, text } = colors;
  if (!background || !panel || !elevated || !text) return undefined;
  return {
    background, panel, elevated, text,
    ...(colors.border ? { border: colors.border } : {}),
    ...(colors.accent ? { accent: colors.accent } : {}),
  };
}

export const VSCODE_OFF_REASON = "VS Code is off. Turn it on in Settings → Tools → VS Code.";

/** Why a VS Code view cannot open on this gateway, or undefined while it can (or the status is not known yet). */
export function vscodeUnavailableReason(status: Pick<VscodeStatus, "state" | "executableError"> | undefined): string | undefined {
  if (!status) return undefined;
  if (status.state === "off") return VSCODE_OFF_REASON;
  if (status.state === "unavailable") return status.executableError || "No compatible VS Code server was found.";
  return undefined;
}
