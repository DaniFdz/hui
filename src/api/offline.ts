/**
 * The browser side of offline reading: the build id this page was compiled
 * with, best-effort production-only service-worker registration that recovers a
 * registration the browser reports with no worker in any slot, and the check
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

/** A registration the browser hands back with no worker in any slot: nothing is installing, waiting or active. */
export function workerless(registration: Pick<ServiceWorkerRegistration, "installing" | "waiting" | "active">): boolean {
  return !(registration.installing ?? registration.waiting ?? registration.active);
}

/**
 * Registers the offline worker, and recovers the registration WebKit can resolve to while an earlier document's
 * `unregister()` is still landing: that one reports no worker in any slot and never gets one by itself, which leaves
 * the page unable to serve itself offline. Every step is decided from the state the browser reports afterwards, so a
 * registration that installed is left alone and one that cannot install is reported once instead of being retried:
 * `update()` makes the browser re-fetch the worker script and install it, and when that still leaves nothing, a fresh
 * `register()` after `unregister()` replaces the registration that is on its way out. A rejected step is no worse than
 * the workerless registration it ran on, so its outcome is read from the next state, not from its own promise.
 */
export async function ensureOfflineWorker(
  container: Pick<ServiceWorkerContainer, "register">,
  url: string,
): Promise<ServiceWorkerRegistration> {
  let registration = await container.register(url);
  if (!workerless(registration)) return registration;
  await registration.update().catch(() => {});
  if (!workerless(registration)) return registration;
  await registration.unregister().catch(() => {});
  registration = await container.register(url);
  if (!workerless(registration)) return registration;
  console.warn("[hui.offlineWorker] the browser kept a registration with no worker after a second install: this page cannot serve itself offline.");
  return registration;
}

export function prepareOffline(): void {
  if (!BUILD_ID || globalThis.isSecureContext !== true) return;
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  void ensureOfflineWorker(navigator.serviceWorker, `${WORKER_URL}?build=${encodeURIComponent(BUILD_ID)}`).catch(() => {});
}
