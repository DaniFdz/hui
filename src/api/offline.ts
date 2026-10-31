/**
 * The browser side of offline reading: the build id this page was compiled
 * with, best-effort production-only service-worker registration, and the check
 * that keeps an old cached page from restoring live controls against a newer
 * gateway build. Development has no build id and never registers the worker.
 */
import { GatewayHttpError } from "./gateway-error.ts";

declare const __HUI_BUILD_ID__: string | undefined;

const BUILD_URL = "/offline-build.json";
const WORKER_URL = "/offline-worker.js";
const CHECK_TIMEOUT_MS = 4_000;

const BUILD_ID = typeof __HUI_BUILD_ID__ === "string" ? __HUI_BUILD_ID__ : undefined;

export class OutdatedBuildError extends Error {
  constructor(message = "HUI has a newer build. Reload HUI to continue.") {
    super(message);
    this.name = "OutdatedBuildError";
  }
}

export async function assertCurrentBuild(signal?: AbortSignal): Promise<void> {
  if (!BUILD_ID) return;
  const deadline = AbortSignal.any([AbortSignal.timeout(CHECK_TIMEOUT_MS), ...(signal ? [signal] : [])]);
  const response = await fetch(BUILD_URL, { cache: "no-store", signal: deadline });
  if (!response.ok) throw new GatewayHttpError(response.status, `HUI could not confirm this page's build (${response.status}).`);
  const payload: unknown = await response.json().catch(() => undefined);
  if (payload === null || typeof payload !== "object" || !("build" in payload) || typeof payload.build !== "string" || !payload.build) {
    throw new OutdatedBuildError("HUI could not confirm this page's build. Reload HUI to continue.");
  }
  if (payload.build !== BUILD_ID) throw new OutdatedBuildError();
}

export function prepareOffline(): void {
  if (!BUILD_ID || globalThis.isSecureContext !== true) return;
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  void navigator.serviceWorker.register(`${WORKER_URL}?build=${encodeURIComponent(BUILD_ID)}`).catch(() => {});
}
