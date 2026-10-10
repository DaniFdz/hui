/**
 * The VS Code view's contract between the gateway and the browser: its routes, the VS Codes the gateway can run
 * (providers), what a first open must ask (license consent, an install, a path), the status the gateway reports, the
 * HUI colors a frame asks VS Code to wear, and the licenses the view links to. Finding and running a provider is
 * server/vscode.ts's job (detection in server/vscode-providers.ts, the managed install in server/vscode-install.ts);
 * the frame is src/components/vscode-view.ts.
 */

/** Every provider's `--server-base-path`: every workbench URL and its WebSocket live under it. */
export const VSCODE_BASE_PATH = "/__hui/vscode";
/** A frame's first load: trades a one-use ticket for the proxy's cookie, then redirects to the folder. */
export const VSCODE_ENTER_PATH = `${VSCODE_BASE_PATH}/enter`;
/** HUI's own guarded JSON route: the status (GET) and the actions in `VscodeAction` (POST `{ action }`). */
export const VSCODE_STATUS_ROUTE = "/__hui/vscode-server";

/** Microsoft's terms for the VS Code Server that `code serve-web` downloads and runs, as that CLI prints them. */
export const VSCODE_SERVER_LICENSE_URL = "https://aka.ms/vscode-server-license";
export const MICROSOFT_PRIVACY_URL = "https://privacy.microsoft.com/en-US/privacystatement";
export const VSCODE_DOWNLOAD_URL = "https://code.visualstudio.com/download";
/** openvscode-server is MIT; HUI downloads Gitpod's release, it does not ship it. */
export const OPENVSCODE_SERVER_URL = "https://github.com/gitpod-io/openvscode-server";
export const OPENVSCODE_SERVER_LICENSE_URL = "https://github.com/gitpod-io/openvscode-server/blob/main/LICENSE.txt";

/**
 * Where a VS Code comes from, in the order `auto` prefers them:
 * - `configured`: the path saved in Settings;
 * - `desktop`: the installed VS Code's `code` CLI, run as `code serve-web` once its license is accepted;
 * - `managed`: the openvscode-server HUI downloaded into its own directory;
 * - `path`: openvscode-server (or a compatible code-server) on PATH.
 */
export type VscodeProviderKind = "configured" | "desktop" | "managed" | "path";
export type VscodeProviderPreference = "auto" | VscodeProviderKind;
export const VSCODE_PROVIDER_ORDER: readonly VscodeProviderKind[] = ["configured", "desktop", "managed", "path"];

/** How HUI launches it: `server` takes openvscode-server's flags, `serve-web` is the VS Code CLI's web server. */
export type VscodeFlavor = "server" | "serve-web";

export type VscodeProvider = {
  kind: VscodeProviderKind;
  flavor: VscodeFlavor;
  path: string;
  /** "Visual Studio Code", or the server's own name from its `--help` banner ("OpenVSCode Server"). */
  name: string;
  version: string;
  /** serve-web only: the VS Code commit its web server build must match. */
  commit?: string;
};

/** `setup`: nothing can open until the operator chooses (consent, install or a path). The rest is the process. */
export type VscodeState = "setup" | "stopped" | "starting" | "running" | "failed";

export type VscodeInstallPhase = "downloading" | "verifying" | "extracting";

/** The openvscode-server HUI can download into its own directory (Linux only). */
export type VscodeInstallStatus = {
  /** Linux on x64, arm64 or armhf. */
  supported: boolean;
  /** Why HUI cannot install it here, as visible text; empty when it can. */
  reason: string;
  /** The pinned release HUI installs. */
  version: string;
  /** The release asset's architecture (`x64`, `arm64`, `armhf`); empty when unsupported. */
  arch: string;
  /** The download's size in bytes; 0 when unsupported. */
  size: number;
  /** Where installs live. */
  dir: string;
  installed: { version: string; path: string } | null;
  task: { phase: VscodeInstallPhase; received: number; total: number } | null;
  /** Why the last install failed; empty when it did not. */
  error: string;
  /** A visible caveat for this machine (NixOS cannot run the generic build without nix-ld); empty when none. */
  hint: string;
};

/** What the view's first-open card offers when nothing can open yet. */
export type VscodeSetup = {
  needed: boolean;
  /** "Use your VS Code": an installed VS Code that runs once its license is accepted. */
  desktop: VscodeProvider | null;
  /** "Install VS Code server": HUI can download openvscode-server here. */
  install: boolean;
  /** "Download VS Code": nothing else applies on this machine. */
  download: boolean;
};

export type VscodeStatus = {
  platform: string;
  /** The first view's opt-in switch, as saved; it no longer gates anything. */
  enabled: boolean;
  /** The path saved in Settings; empty finds one. */
  configuredExecutable: string;
  preference: VscodeProviderPreference;
  /** Every VS Code this machine can run, in preference order. */
  providers: VscodeProvider[];
  /** Candidates found but not usable, each as visible text (an incompatible code-server, a broken path). */
  problems: string[];
  /** What the next open runs; null while setup is needed. */
  active: VscodeProvider | null;
  /** Why nothing can open yet beyond the setup choices, such as a configured path that does not run; empty otherwise. */
  activeError: string;
  setup: VscodeSetup;
  /** Microsoft's VS Code Server license, which `code serve-web` needs. */
  license: { accepted: boolean; acceptedAt: string };
  install: VscodeInstallStatus;
  state: VscodeState;
  /** The provider of the running (or starting) server. */
  running: VscodeProvider | null;
  /** serve-web's first start downloads Microsoft's web server build: the bytes so far (total 0 until known). */
  preparing: { received: number; total: number } | null;
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

export type VscodeAction = "stop" | "accept-license" | "revoke-license" | "install" | "cancel-install" | "uninstall";
export const VSCODE_ACTIONS: readonly VscodeAction[] = ["stop", "accept-license", "revoke-license", "install", "cancel-install", "uninstall"];

/** Refusals the browser distinguishes: `setup` shows the first-open card, the next two point at the conversation. */
export type VscodeErrorCode = "setup" | "remote" | "folder" | "failed" | "busy";

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

/** WCAG relative luminance of #rrggbb. */
function relativeLuminance(hex: string): number {
  const channel = (offset: number) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/** WCAG contrast ratio of two #rrggbb colors, 1 to 21. */
export function vscodeContrast(a: string, b: string): number {
  const [light, dark] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

/** Below this, text on the theme's background or panels is not readable (WCAG's floor for large text). */
export const VSCODE_THEME_MIN_CONTRAST = 3;

/** Only #rrggbb values pass: anything else could reach VS Code's settings. The four base colors are required, and a
 * theme whose text cannot be read on its background or panels is refused: VS Code then keeps its own theme instead
 * of painting an unreadable workbench (a client that could not read HUI's colors once sent black for all of them). */
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
  if ([background, panel, elevated].some((surface) => vscodeContrast(text, surface) < VSCODE_THEME_MIN_CONTRAST)) return undefined;
  return {
    background, panel, elevated, text,
    ...(colors.border ? { border: colors.border } : {}),
    ...(colors.accent ? { accent: colors.accent } : {}),
  };
}

/** Where a provider comes from, as Settings words it. */
export function vscodeProviderSource(kind: VscodeProviderKind): string {
  switch (kind) {
    case "configured": return "the path in Settings";
    case "desktop": return "your VS Code";
    case "managed": return "installed by HUI";
    default: return "found on PATH";
  }
}

/** "77 MB" for a download size. */
export function formatVscodeBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}
