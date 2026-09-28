/** HUI's managed browser, as reported to Settings → Tools → Browser. The
 * gateway owns the browser process; the view only renders this projection. */

export type BrowserTabView = {
  /** Short tab handle agents use, such as `t3`. */
  id: string;
  ownerSessionId: string;
  /** The owning conversation's title, when it is still registered. */
  ownerTitle: string;
  title: string;
  url: string;
};

export type BrowserExecutableView = {
  path: string;
  name: string;
  source: "configured" | "detected";
};

export type BrowserState = "stopped" | "starting" | "running" | "stopping";

export type BrowserStatus = {
  enabled: boolean;
  /** Configured mode for the next launch. */
  headless: boolean;
  /** Configured path; empty auto-detects. */
  executablePath: string;
  executable: BrowserExecutableView | null;
  executableError: string;
  state: BrowserState;
  /** Mode of the running process, which can lag a just-changed setting. */
  mode?: "headless" | "windowed";
  version?: string;
  startedAt?: string;
  /** HUI's own user-data directory; cookies and logins persist here. */
  profileDir: string;
  lastError: string;
  tabs: BrowserTabView[];
};

const STATES = new Set<BrowserState>(["stopped", "starting", "running", "stopping"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, maximum = 4_096): string {
  return typeof value === "string" ? value.slice(0, maximum) : "";
}

/** Browser-side normalization of `GET /__hui/browser`; drops malformed rows. */
export function normalizeBrowserStatus(raw: unknown): BrowserStatus {
  const source = isRecord(raw) ? raw : {};
  const executable = isRecord(source["executable"]) && typeof source["executable"]["path"] === "string"
    ? {
        path: text(source["executable"]["path"]),
        name: text(source["executable"]["name"], 80) || "Browser",
        source: source["executable"]["source"] === "configured" ? "configured" as const : "detected" as const,
      }
    : null;
  const state = typeof source["state"] === "string" && STATES.has(source["state"] as BrowserState)
    ? source["state"] as BrowserState
    : "stopped";
  const tabs = Array.isArray(source["tabs"])
    ? source["tabs"].filter(isRecord).flatMap((tab) => typeof tab["id"] === "string" && typeof tab["ownerSessionId"] === "string"
      ? [{
          id: text(tab["id"], 16),
          ownerSessionId: text(tab["ownerSessionId"], 200),
          ownerTitle: text(tab["ownerTitle"], 200),
          title: text(tab["title"], 300),
          url: text(tab["url"], 2_048),
        }]
      : [])
    : [];
  return {
    enabled: source["enabled"] !== false,
    headless: source["headless"] !== false,
    executablePath: text(source["executablePath"]),
    executable,
    executableError: text(source["executableError"], 1_000),
    state,
    ...(source["mode"] === "headless" || source["mode"] === "windowed" ? { mode: source["mode"] } : {}),
    ...(typeof source["version"] === "string" ? { version: text(source["version"], 200) } : {}),
    ...(typeof source["startedAt"] === "string" ? { startedAt: text(source["startedAt"], 64) } : {}),
    profileDir: text(source["profileDir"]),
    lastError: text(source["lastError"], 1_000),
    tabs,
  };
}

/* ── Live view ──────────────────────────────────────────────────────────────
 * A conversation's browser pane receives these over a one-use WebSocket:
 * JSON text for state and agent actions, binary messages for frames. */

export type BrowserViewTab = { id: string; title: string; url: string };

export type BrowserViewState = {
  running: boolean;
  mode?: "headless" | "windowed";
  /** This conversation's tabs, oldest first. */
  tabs: BrowserViewTab[];
  /** The tab the agent is working in. */
  current: string | null;
  /** The tab whose frames this viewer receives. */
  watching: string | null;
  /** False while the viewer has picked a tab other than the agent's current one. */
  following: boolean;
};

export type BrowserViewAction = {
  tabId: string;
  /** Human-readable summary such as `Clicked e4 (button "Save")`. Never includes typed text. */
  text: string;
  /** Viewport CSS pixels of a pointer action. */
  point?: { x: number; y: number };
  at: string;
};

export type BrowserViewMessage = ({ type: "state" } & BrowserViewState) | ({ type: "action" } & BrowserViewAction);

/** Frame header; `width`/`height` are the page viewport the image shows, in CSS pixels. */
export type BrowserFrameHeader = { tabId: string; width: number; height: number; seq: number };

const TAB_ID = /^t\d{1,6}$/u;
const MAX_FRAME_HEADER = 4_096;

function viewTab(value: unknown): BrowserViewTab | undefined {
  if (!isRecord(value) || typeof value["id"] !== "string" || !TAB_ID.test(value["id"])) return undefined;
  return { id: value["id"], title: text(value["title"], 300), url: text(value["url"], 2_048) };
}

function tabRef(value: unknown): string | null {
  return typeof value === "string" && TAB_ID.test(value) ? value : null;
}

/** Browser-side validation of a live-view text message; unknown shapes are dropped. */
export function parseBrowserViewMessage(raw: unknown): BrowserViewMessage | undefined {
  if (!isRecord(raw)) return undefined;
  if (raw["type"] === "state") {
    const tabs = Array.isArray(raw["tabs"]) ? raw["tabs"].flatMap((tab) => viewTab(tab) ?? []) : [];
    return {
      type: "state",
      running: raw["running"] === true,
      ...(raw["mode"] === "headless" || raw["mode"] === "windowed" ? { mode: raw["mode"] } : {}),
      tabs,
      current: tabRef(raw["current"]),
      watching: tabRef(raw["watching"]),
      following: raw["following"] !== false,
    };
  }
  if (raw["type"] === "action" && typeof raw["tabId"] === "string" && TAB_ID.test(raw["tabId"]) && typeof raw["text"] === "string") {
    const point = isRecord(raw["point"]) && Number.isFinite(raw["point"]["x"]) && Number.isFinite(raw["point"]["y"])
      ? { x: Number(raw["point"]["x"]), y: Number(raw["point"]["y"]) }
      : undefined;
    return { type: "action", tabId: raw["tabId"], text: text(raw["text"], 300), ...(point ? { point } : {}), at: text(raw["at"], 64) };
  }
  return undefined;
}

/** `[u32 big-endian header length][header JSON][JPEG]` */
export function encodeBrowserFrame(header: BrowserFrameHeader, image: Uint8Array): Uint8Array {
  const json = new TextEncoder().encode(JSON.stringify(header));
  const out = new Uint8Array(4 + json.length + image.length);
  new DataView(out.buffer).setUint32(0, json.length);
  out.set(json, 4);
  out.set(image, 4 + json.length);
  return out;
}

export function decodeBrowserFrame(data: ArrayBuffer | Uint8Array): { header: BrowserFrameHeader; image: Uint8Array } | undefined {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes.length < 4) return undefined;
  const length = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0);
  if (length === 0 || length > MAX_FRAME_HEADER || 4 + length >= bytes.length) return undefined;
  let header: unknown;
  try {
    header = JSON.parse(new TextDecoder().decode(bytes.subarray(4, 4 + length)));
  } catch {
    return undefined;
  }
  if (!isRecord(header) || typeof header["tabId"] !== "string" || !TAB_ID.test(header["tabId"])) return undefined;
  const size = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 16_384;
  if (!size(header["width"]) || !size(header["height"]) || typeof header["seq"] !== "number") return undefined;
  return {
    header: { tabId: header["tabId"], width: header["width"] as number, height: header["height"] as number, seq: header["seq"] },
    image: bytes.subarray(4 + length),
  };
}
