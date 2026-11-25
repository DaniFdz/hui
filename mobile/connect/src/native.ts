/**
 * The native half of the Connect page: the reachability probe and the calls into the app's own `HuiGateway` plugin.
 * It is the only module here that touches `@capacitor/core`, so the page's checks stay testable without a bridge.
 */
import { Capacitor, CapacitorHttp, registerPlugin } from "@capacitor/core";
import { normalizeGatewayName, settingsWithName } from "./gateway";

/** The Android and iOS side of the Connect page (see mobile/AGENTS.md, "The Connect handoff"). */
interface HuiGatewayPlugin {
  /** Remember a gateway and rebuild the app's bridge on it. */
  connect(options: { url: string }): Promise<{ url: string }>;
  /** Forget the remembered gateway and come back to this page. */
  forget(): Promise<{ gateway: string | null }>;
  /** What this launch knows: the remembered gateway and the one that just failed to answer, if any. */
  getState(): Promise<{ gateway: string | null; failed: string | null }>;
  /** Ask for local-network access before a LAN probe; iOS has no runtime API and answers granted. */
  requestLocalNetwork(): Promise<{ status: string }>;
}

const huiGateway = registerPlugin<HuiGatewayPlugin>("HuiGateway");

/** Whether the page runs inside the app's WebView rather than a plain browser. */
export function isNative(): boolean {
  return Capacitor.isNativePlatform();
}

/** What the shell remembers about this launch. A browser knows nothing. */
export async function shellState(): Promise<{ gateway: string | null; failed: string | null }> {
  if (!isNative()) return { gateway: null, failed: null };
  return huiGateway.getState();
}

/**
 * Ask the shell for local-network access before a probe. Android 17 needs the runtime permission; older Android and iOS
 * answer granted, and the iOS prompt is raised by the probe itself. A denial is the Connect page's to report.
 */
export async function requestLocalNetwork(): Promise<"granted" | "denied"> {
  if (!isNative()) return "granted";
  const { status } = await huiGateway.requestLocalNetwork();
  return status === "denied" ? "denied" : "granted";
}

/**
 * Ask a gateway for its update snapshot. On a device this goes through Capacitor's native HTTP: a cross-origin
 * `fetch` from the Connect page (origin `https://localhost`) preflights, and the gateway refuses cross-origin
 * requests, so the probe would report every gateway as refused. A plain browser has only `fetch`.
 */
export async function probeGateway(base: string): Promise<{ status: number; body: unknown }> {
  const url = `${base}/__hui/update`;
  const headers = { "x-hui": "1" };
  if (isNative()) {
    const response = await CapacitorHttp.get({ url, headers, connectTimeout: 5000, readTimeout: 5000, responseType: "json" });
    return { status: response.status, body: response.data };
  }
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(5000) });
  return { status: response.status, body: await response.json().catch(() => null) };
}

/** Hand the chosen address to the app, which remembers it and reloads on it. */
export async function connectGateway(base: string): Promise<void> {
  await huiGateway.connect({ url: base });
}

/** Forget the remembered gateway and come back to a clean Connect page. */
export async function forgetGateway(): Promise<void> {
  await huiGateway.forget();
}

/**
 * Save the gateway's own name before the app loads it. `PUT /__hui/settings` replaces missing fields with defaults, so
 * this reads the current document first and sends it back with only `name` changed. The write uses native HTTP for the
 * same reason the probe does: a cross-origin PUT from `https://localhost` would be refused.
 */
export async function saveGatewayName(base: string, name: string): Promise<string> {
  const url = `${base}/__hui/settings`;
  const read = await CapacitorHttp.get({
    url,
    headers: { "x-hui": "1" },
    connectTimeout: 5_000,
    readTimeout: 5_000,
    responseType: "json",
  });
  if (read.status !== 200) throw new Error(`the gateway answered ${read.status} when reading its settings`);
  const next = settingsWithName(read.data, name);
  if (next === null) throw new Error("the gateway's settings did not read as a settings document");
  const write = await CapacitorHttp.request({
    method: "PUT",
    url,
    headers: { "x-hui": "1", "content-type": "application/json" },
    data: next,
    connectTimeout: 5_000,
    readTimeout: 5_000,
    responseType: "json",
  });
  if (write.status !== 200) throw new Error(`the gateway answered ${write.status} when saving its name`);
  const saved = typeof write.data === "string" ? JSON.parse(write.data) as unknown : write.data;
  const savedName = typeof saved === "object" && saved !== null && typeof (saved as Record<string, unknown>)["name"] === "string"
    ? (saved as Record<string, string>)["name"]
    : "";
  if (savedName !== normalizeGatewayName(name)) throw new Error("the gateway did not keep the name it was given");
  return savedName;
}
