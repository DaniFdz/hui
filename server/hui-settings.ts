/**
 * HUI's own settings file in its config directory: reading and writing it, always normalized.
 * A missing or malformed file reads as the defaults instead of an error. The gateway's own name
 * lives here beside the operator's profile (`name`); what a client sees when it is empty is
 * `control-surfaces.ts`'s effective name.
 *
 * Appearance is not here. A theme, colour mode, accent, typeface, text size or conversation
 * preference belongs to the screen that shows it, kept in that device's own storage
 * (`src/lib/appearance/store.ts`), because one gateway serves many screens and people.
 * `cli/doctor-appearance.ts` reports and clears the keys an older file still carries.
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { CONFIG_DIR } from "./paths.ts";
import { isToolIconName } from "./tool-icons.ts";
import { THINKING_LEVELS } from "./sessions/thinking.ts";
import type { Settings, BrowserSettings, VscodeSettings, VscodeProviderPreference, NtfySettings } from "./api/settings.ts";
import { normalizeOriginPatterns } from "./browser/origins.ts";
export type { Settings, BrowserSettings, VscodeSettings, VscodeProviderPreference, NtfySettings } from "./api/settings.ts";

const GPT_LIVE_VOICES = ["cove", "arbor", "breeze", "ember", "juniper", "maple", "sol", "spruce", "vale"] as const;

type GptLiveVoice = (typeof GPT_LIVE_VOICES)[number];
const DEFAULT_GPT_LIVE_VOICE: GptLiveVoice = "cove";

function gptLiveVoice(value: unknown): GptLiveVoice | undefined {
  if (typeof value !== "string") return undefined;
  const voice = value.trim().toLowerCase();
  return GPT_LIVE_VOICES.find((candidate) => candidate === voice);
}

export const HUI_SETTINGS_FILE = join(CONFIG_DIR, "settings.json");

export async function readHuiSettingsAt(path: string): Promise<Settings> {
  try {
    return normalizeSettings(JSON.parse(await readFile(path, "utf8")));
  } catch {
    return normalizeSettings(undefined);
  }
}

export function readHuiSettings(): Promise<Settings> {
  return readHuiSettingsAt(HUI_SETTINGS_FILE);
}

export async function writeHuiSettings(raw: unknown): Promise<Settings> {
  const settings = normalizeSettings(raw);
  await writeFile(HUI_SETTINGS_FILE, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  return settings;
}

export const QUESTION_TIMEOUTS = [0, 5, 10, 15, 30, 60] as const;

export const DEFAULT_BRANCH_PREFIX = "feature/";
export const DEFAULT_BROWSER_SETTINGS: BrowserSettings = { enabled: true, headless: true, executablePath: "", mirrorState: false, allowedOrigins: [] };
export const DEFAULT_VSCODE_SETTINGS: VscodeSettings = { enabled: false, executable: "", provider: "auto", licenseAcceptedAt: "" };
/** The public ntfy service: a phone subscribes to a topic there, and a gateway that runs its own sets its address. */
export const DEFAULT_NTFY_SERVER = "https://ntfy.sh";
export const DEFAULT_NTFY_SETTINGS: NtfySettings = { server: DEFAULT_NTFY_SERVER, topic: "" };
const VSCODE_PROVIDERS: readonly VscodeProviderPreference[] = ["auto", "configured", "desktop", "managed", "path"];

export const DEFAULT_SETTINGS: Settings = {
  // A tool's own mark and icon file stay here: the files live in the gateway's config directory, so every device
  // that draws a tool call reads them from the gateway that serves it.
  chat: { toolMarks: {}, toolIcons: {} },
  profileName: "HUI Operator",
  profileHandle: "",
  name: "",
  branchPrefix: DEFAULT_BRANCH_PREFIX,
  browser: DEFAULT_BROWSER_SETTINGS,
  codemode: { enabled: true },
  questions: { timeoutMinutes: 0 },
  vscode: DEFAULT_VSCODE_SETTINGS,
  power: { keepAwake: true },
  notifications: { tool: false, runFinished: false, runFailed: true, needsInput: true, ntfy: DEFAULT_NTFY_SETTINGS },
  models: { primary: "", fallback: "", utility: "", thinking: "", retryAttempts: 3, routes: [] },
  calls: { voice: DEFAULT_GPT_LIVE_VOICE },
  disabledSkills: [],
  disabledPlugins: [],
  labs: { denseObservability: false, detailedDebug: false },
};

export function normalizeSettings(raw: unknown): Settings {
  const source = isRecord(raw) ? raw : {};
  return {
    chat: normalizeChat(source["chat"]),
    profileName: boundedText(source["profileName"], DEFAULT_SETTINGS.profileName, 80),
    profileHandle: boundedText(source["profileHandle"], "", 80),
    // Empty is not a name: the gateway reports this machine's hostname until the operator sets one.
    name: boundedText(source["name"], "", 60),
    branchPrefix: normalizeBranchPrefix(source["branchPrefix"]),
    browser: normalizeBrowserSettings(source["browser"]),
    codemode: { enabled: !isRecord(source["codemode"]) || source["codemode"]["enabled"] !== false },
    questions: { timeoutMinutes: QUESTION_TIMEOUTS.find((minutes) => isRecord(source["questions"]) && source["questions"]["timeoutMinutes"] === minutes) ?? 0 },
    vscode: normalizeVscodeSettings(source["vscode"]),
    power: normalizePower(source["power"]),
    notifications: normalizeNotifications(source["notifications"]),

    models: normalizeModels(source["models"]),
    calls: normalizeCalls(source["calls"]),
    disabledSkills: normalizeDisabledSkills(source["disabledSkills"]),
    disabledPlugins: normalizeDisabledPlugins(source["disabledPlugins"]),
    labs: normalizeLabs(source["labs"]),
  };
}

export function normalizeCalls(value: unknown): Settings["calls"] {
  const source = isRecord(value) ? value : {};
  return { voice: gptLiveVoice(source["voice"]) ?? DEFAULT_GPT_LIVE_VOICE };
}

export function normalizeBrowserSettings(value: unknown): BrowserSettings {
  const source = isRecord(value) ? value : {};
  const path = typeof source["executablePath"] === "string" ? source["executablePath"].trim() : "";
  return {
    enabled: source["enabled"] !== false,
    headless: source["headless"] !== false,
    executablePath: path.length <= 4_096 && !/[\p{Cc}]/u.test(path) ? path : "",
    // Opt-in: only an explicit true lends a machine's cookies and logins to another.
    mirrorState: source["mirrorState"] === true,
    // Empty is anywhere; a set list is the browser's whole reach.
    allowedOrigins: normalizeOriginPatterns(source["allowedOrigins"]),
  };
}

export function normalizeVscodeSettings(value: unknown): VscodeSettings {
  const source = isRecord(value) ? value : {};
  const path = typeof source["executable"] === "string" ? source["executable"].trim() : "";
  const provider = VSCODE_PROVIDERS.find((value) => value === source["provider"]) ?? "auto";
  const accepted = typeof source["licenseAcceptedAt"] === "string" ? source["licenseAcceptedAt"].trim() : "";
  return {
    enabled: source["enabled"] === true,
    executable: path.length <= 4_096 && !/[\p{Cc}]/u.test(path) ? path : "",
    provider,
    licenseAcceptedAt: accepted.length <= 64 && !Number.isNaN(Date.parse(accepted)) ? accepted : "",
  };
}

function normalizePower(value: unknown): Settings["power"] {
  return { keepAwake: !(isRecord(value) && value["keepAwake"] === false) };
}

function normalizeNotifications(value: unknown): Settings["notifications"] {
  const source = isRecord(value) ? value : {};
  return {
    tool: source["tool"] === true,
    runFinished: source["runFinished"] === true,
    runFailed: source["runFailed"] !== false,
    needsInput: source["needsInput"] !== false,
    ntfy: normalizeNtfySettings(source["ntfy"]),
  };
}

/**
 * The ntfy relay a phone subscribes to. A topic is ntfy's own capability: `[-_A-Za-z0-9]` up to 64 characters, and
 * nothing else means off. The server is an `http(s)` base address with no credentials, query or fragment, so a saved
 * address cannot smuggle a token into a URL HUI prints, and anything malformed falls back to the public service with
 * no topic rather than publishing somewhere else.
 */
export function normalizeNtfySettings(value: unknown): NtfySettings {
  const source = isRecord(value) ? value : {};
  const server = typeof source["server"] === "string" ? source["server"].trim() : "";
  const topic = typeof source["topic"] === "string" ? source["topic"].trim() : "";
  return {
    server: normalizeNtfyServer(server),
    topic: /^[A-Za-z0-9_-]{1,64}$/u.test(topic) ? topic : "",
  };
}

function normalizeNtfyServer(server: string): string {
  if (!server) return DEFAULT_NTFY_SERVER;
  if (server.length > 2_048 || /[\p{Cc}\s]/u.test(server)) return DEFAULT_NTFY_SERVER;
  try {
    const url = new URL(server);
    if ((url.protocol !== "https:" && url.protocol !== "http:") || !url.hostname || url.username || url.password || url.search || url.hash) {
      return DEFAULT_NTFY_SERVER;
    }
    return `${url.origin}${url.pathname}`.replace(/\/+$/u, "") || DEFAULT_NTFY_SERVER;
  } catch {
    return DEFAULT_NTFY_SERVER;
  }
}

function normalizeModelRef(value: unknown): string {
  if (typeof value !== "string") return "";
  const ref = value.trim();
  return ref.length <= 200 && /^[^/\s]+\/\S+$/u.test(ref) ? ref : "";
}

function normalizeModels(value: unknown): Settings["models"] {
  const source = isRecord(value) ? value : {};
  const attempts = Number(source["retryAttempts"]);
  return {
    primary: normalizeModelRef(source["primary"]),
    fallback: normalizeModelRef(source["fallback"]),
    utility: normalizeModelRef(source["utility"]),
    thinking: savedReasoningLevel(source["thinking"]) ?? "",
    retryAttempts: Number.isFinite(attempts) ? Math.min(5, Math.max(0, Math.trunc(attempts))) : 3,
    routes: normalizeSubagentRoutes(source["routes"]),
  };
}

/** PI's reasoning levels, which a saved default or a route may pin. Ultra is not one: it is a session's own choice. */
const SAVED_REASONING_LEVELS = THINKING_LEVELS.filter((level) => level !== "ultra");

function savedReasoningLevel(value: unknown): (typeof SAVED_REASONING_LEVELS)[number] | undefined {
  return SAVED_REASONING_LEVELS.find((level) => level === value);
}

function routeNameIsValid(name: string): boolean {
  return name.length <= 40 && /^[\p{L}\p{N}_.-]+$/u.test(name);
}

function normalizeSubagentRoutes(value: unknown): Settings["models"]["routes"] {
  if (!Array.isArray(value)) return [];
  const routes = new Map<string, Settings["models"]["routes"][number]>();
  for (const item of value) {
    if (!isRecord(item)) continue;
    const name = typeof item["name"] === "string" ? item["name"].trim() : "";
    const rawModel = typeof item["model"] === "string" ? item["model"].trim() : "";
    const model = normalizeModelRef(rawModel);
    const thinking = savedReasoningLevel(item["thinking"]);
    // A route with no model inherits the caller's model and thinking; a model that is present but malformed drops the route.
    if (!routeNameIsValid(name) || (rawModel && !model) || routes.has(name)) continue;
    routes.set(name, {
      name,
      description: boundedText(item["description"], "", 200).replace(/\s+/gu, " ").trim(),
      model,
      ...(thinking ? { thinking } : {}),
    });
    if (routes.size >= 50) break;
  }
  return [...routes.values()];
}

function normalizeDisabledPlugins(value: unknown): Settings["disabledPlugins"] {
  if (!Array.isArray(value)) return [];
  const plugins = new Map<string, Settings["disabledPlugins"][number]>();
  for (const item of value) {
    if (!isRecord(item)) continue;
    const id = boundedText(item["id"], "", 64);
    const name = boundedText(item["name"], "", 200);
    const kind = item["kind"];
    if (!/^[a-f0-9]{24}$/u.test(id) || !name || (kind !== "package" && kind !== "extension")) continue;
    if (!plugins.has(id)) plugins.set(id, { id, name, kind });
    if (plugins.size >= 1_000) break;
  }
  return [...plugins.values()];
}

function normalizeDisabledSkills(value: unknown): Settings["disabledSkills"] {
  if (!Array.isArray(value)) return [];
  const skills = new Map<string, { name: string; path: string }>();
  for (const item of value) {
    if (!isRecord(item)) continue;
    const name = boundedText(item["name"], "", 64);
    const path = boundedText(item["path"], "", 4_096);
    if (!name || !path || /[\p{Cc}]/u.test(path)) continue;
    if (!skills.has(path)) skills.set(path, { name, path });
    if (skills.size >= 1_000) break;
  }
  return [...skills.values()];
}

/** `chat.toolMarks`: the user's own emoji per CLI or tool name. Display-only, lowercased keys, capped so a
 * hand-edited settings file cannot bloat every settings payload. */
function normalizeToolMarks(value: unknown): Settings["chat"]["toolMarks"] {
  if (!isRecord(value)) return {};
  const marks: Record<string, string> = {};
  for (const [rawKey, rawValue] of Object.entries(value)) {
    const key = rawKey.trim().toLowerCase().slice(0, 40);
    if (!key || /[\p{Cc}\s]/u.test(key) || typeof rawValue !== "string") continue;
    const mark = rawValue.trim();
    if (!mark || /[\p{Cc}]/u.test(mark) || Array.from(mark).length > 12) continue;
    marks[key] = mark;
    if (Object.keys(marks).length >= 200) break;
  }
  return marks;
}

/** `chat.toolIcons`: a CLI or tool name to one flat icon file name the gateway can serve. */
function normalizeToolIcons(value: unknown): Settings["chat"]["toolIcons"] {
  if (!isRecord(value)) return {};
  const icons: Record<string, string> = {};
  for (const [rawKey, rawValue] of Object.entries(value)) {
    const key = rawKey.trim().toLowerCase().slice(0, 40);
    if (!key || /[\p{Cc}\s]/u.test(key) || !isToolIconName(rawValue)) continue;
    icons[key] = rawValue;
    if (Object.keys(icons).length >= 200) break;
  }
  return icons;
}

/** A file saved before appearance moved to the device still carries the chat preferences that went with it: they
 * are not read, so the next save leaves them out and `hui doctor` offers to clear them now. */
function normalizeChat(value: unknown): Settings["chat"] {
  const source = isRecord(value) ? value : {};
  return {
    toolMarks: normalizeToolMarks(source["toolMarks"]),
    toolIcons: normalizeToolIcons(source["toolIcons"]),
  };
}

export function normalizeBranchPrefix(value: unknown): string {
  if (typeof value !== "string") return DEFAULT_BRANCH_PREFIX;
  const raw = value.trim();
  if (!raw) return DEFAULT_BRANCH_PREFIX;
  const prefix = raw.endsWith("/") ? raw : `${raw}/`;
  if (
    prefix.length > 80 ||
    prefix.startsWith("/") ||
    prefix.includes("//") ||
    prefix.includes("..") ||
    prefix.includes("@{") ||
    /[\\\s~^:?*[\]]/u.test(prefix)
  ) return DEFAULT_BRANCH_PREFIX;
  const parts = prefix.slice(0, -1).split("/");
  if (parts.some((part) => !part || part.startsWith(".") || part.endsWith(".") || part.endsWith(".lock"))) {
    return DEFAULT_BRANCH_PREFIX;
  }
  return prefix;
}

function boundedText(value: unknown, fallback: string, maximum: number): string {
  if (typeof value !== "string") return fallback;
  return value.trim().slice(0, maximum);
}

function normalizeLabs(value: unknown): Settings["labs"] {
  const source = isRecord(value) ? value : {};
  return {
    denseObservability: source["denseObservability"] === true,
    detailedDebug: source["detailedDebug"] === true,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
