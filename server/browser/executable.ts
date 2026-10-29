/**
 * Chromium-family executable discovery for HUI's managed browser.
 *
 * The gateway only launches a binary the operator configured or one found in a
 * well-known install location. Nothing is downloaded, and a configured path
 * that is unusable is reported instead of silently falling back.
 */
import { constants } from "node:fs";
import { access, readdir as readDirectory, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, delimiter, isAbsolute, join, win32 } from "node:path";

export type BrowserExecutable = {
  path: string;
  /** Display name such as "Google Chrome" or "Brave". */
  name: string;
  source: "configured" | "detected";
};

export type ExecutableResolution =
  | { executable: BrowserExecutable; error?: undefined }
  | { executable: null; error: string };

export type ExecutableProbe = {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  home: string;
  isExecutable: (path: string) => Promise<boolean>;
  /** Names in a directory, for a browser that lives in a versioned folder of it. */
  readdir: (path: string) => Promise<string[]>;
};

type Candidate = { name: string; path?: string; command?: string };

/** Preference order mirrors OpenClaw's managed browser: Chrome, Brave, Edge, Chromium. */
const LINUX_CANDIDATES: readonly Candidate[] = [
  { name: "Google Chrome", command: "google-chrome-stable" },
  { name: "Google Chrome", command: "google-chrome" },
  { name: "Google Chrome", path: "/opt/google/chrome/chrome" },
  { name: "Brave", command: "brave-browser" },
  { name: "Brave", command: "brave" },
  { name: "Brave", path: "/opt/brave.com/brave/brave" },
  { name: "Microsoft Edge", command: "microsoft-edge-stable" },
  { name: "Microsoft Edge", command: "microsoft-edge" },
  { name: "Microsoft Edge", path: "/opt/microsoft/msedge/msedge" },
  { name: "Chromium", command: "chromium" },
  { name: "Chromium", command: "chromium-browser" },
  { name: "Chromium", path: "/snap/bin/chromium" },
  { name: "Chromium", path: "/usr/lib/chromium/chromium" },
];

const MAC_APPS: ReadonlyArray<readonly [string, string]> = [
  ["Google Chrome", "Google Chrome.app/Contents/MacOS/Google Chrome"],
  ["Brave", "Brave Browser.app/Contents/MacOS/Brave Browser"],
  ["Microsoft Edge", "Microsoft Edge.app/Contents/MacOS/Microsoft Edge"],
  ["Chromium", "Chromium.app/Contents/MacOS/Chromium"],
  ["Google Chrome Canary", "Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary"],
];

const WINDOWS_APPS: ReadonlyArray<readonly [string, string]> = [
  ["Google Chrome", "Google\\Chrome\\Application\\chrome.exe"],
  ["Brave", "BraveSoftware\\Brave-Browser\\Application\\brave.exe"],
  ["Microsoft Edge", "Microsoft\\Edge\\Application\\msedge.exe"],
  ["Chromium", "Chromium\\Application\\chrome.exe"],
];

export function browserCandidates(platform: NodeJS.Platform, env: NodeJS.ProcessEnv, home: string): Candidate[] {
  if (platform === "darwin") {
    return MAC_APPS.flatMap(([name, relative]) => [
      { name, path: join("/Applications", relative) },
      { name, path: join(home, "Applications", relative) },
    ]);
  }
  if (platform === "win32") {
    const roots = [env["LOCALAPPDATA"], env["PROGRAMFILES"], env["PROGRAMFILES(X86)"]]
      .filter((root): root is string => typeof root === "string" && root.length > 0);
    return WINDOWS_APPS.flatMap(([name, relative]) => roots.map((root) => ({ name, path: win32.join(root, relative) })));
  }
  return [...LINUX_CANDIDATES];
}

async function isExecutableFile(path: string): Promise<boolean> {
  try {
    const info = await stat(path);
    if (!info.isFile()) return false;
    if (process.platform !== "win32") await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function defaultExecutableProbe(): ExecutableProbe {
  return { platform: process.platform, env: process.env, home: homedir(), isExecutable: isExecutableFile, readdir: async (path) => readDirectory(path) };
}

/** Playwright's own Chromium (`npx playwright install chromium`), newest
 * revision first: the browser a container or a remote machine gets without a
 * system package (Ubuntu's `chromium` is a snap stub). */
async function playwrightChromium(probe: ExecutableProbe): Promise<BrowserExecutable | undefined> {
  if (probe.platform !== "linux") return undefined;
  const root = probe.env["PLAYWRIGHT_BROWSERS_PATH"] || join(probe.home, ".cache", "ms-playwright");
  const revisions = (await probe.readdir(root).catch(() => [] as string[]))
    .flatMap((entry) => {
      const match = /^chromium-(\d+)$/u.exec(entry);
      return match ? [{ entry, revision: Number(match[1]) }] : [];
    })
    .sort((a, b) => b.revision - a.revision);
  for (const { entry } of revisions) {
    const path = join(root, entry, "chrome-linux", "chrome");
    if (await probe.isExecutable(path)) return { path, name: "Chromium", source: "detected" };
  }
  return undefined;
}

/** `~/…` is expanded, and a macOS `.app` bundle resolves to its main binary
 * so an operator can paste `/Applications/Google Chrome.app` directly. */
export function expandExecutablePath(raw: string, home: string, platform: NodeJS.Platform): string {
  let path = raw.trim();
  if (path === "~" || path.startsWith("~/")) path = join(home, path.slice(2));
  if (platform === "darwin" && /\.app\/?$/u.test(path)) {
    const bundle = path.replace(/\/$/u, "");
    path = join(bundle, "Contents", "MacOS", basename(bundle, ".app"));
  }
  return path;
}

function displayName(path: string): string {
  const lower = path.toLowerCase();
  if (lower.includes("brave")) return "Brave";
  if (lower.includes("edge")) return "Microsoft Edge";
  if (lower.includes("canary")) return "Google Chrome Canary";
  if (lower.includes("chromium")) return "Chromium";
  if (lower.includes("chrome")) return "Google Chrome";
  return basename(path);
}

export async function resolveBrowserExecutable(
  configured: string,
  probe: ExecutableProbe = defaultExecutableProbe(),
): Promise<ExecutableResolution> {
  if (configured.trim()) {
    const path = expandExecutablePath(configured, probe.home, probe.platform);
    const absolute = probe.platform === "win32" ? win32.isAbsolute(path) : isAbsolute(path);
    if (!absolute) return { executable: null, error: "The browser executable must be an absolute path." };
    if (!(await probe.isExecutable(path))) {
      return { executable: null, error: `No executable browser was found at ${path}.` };
    }
    return { executable: { path, name: displayName(path), source: "configured" } };
  }
  const separator = probe.platform === "win32" ? ";" : delimiter;
  const searchPath = (probe.env["PATH"] ?? "").split(separator).filter(Boolean);
  for (const candidate of browserCandidates(probe.platform, probe.env, probe.home)) {
    const paths = candidate.path
      ? [candidate.path]
      : searchPath.map((directory) => join(directory, candidate.command ?? ""));
    for (const path of paths) {
      if (await probe.isExecutable(path)) return { executable: { path, name: candidate.name, source: "detected" } };
    }
  }
  const playwright = await playwrightChromium(probe);
  if (playwright) return { executable: playwright };
  return {
    executable: null,
    error: "No Chromium-family browser was found. Install Google Chrome, Brave, Microsoft Edge or Chromium, or set its executable path.",
  };
}
