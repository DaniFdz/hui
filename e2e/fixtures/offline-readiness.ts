/** Read-only offline-worker diagnostics: browser state readers and a per-test, Node-side change logger. */
type WorkerState = { state: string; scriptURL: string } | null;
export type OfflineReadinessState = {
  url: string;
  documentReadyState: string;
  supported: boolean;
  registration: { scope: string; installing: WorkerState; waiting: WorkerState; active: WorkerState } | null;
  controller: WorkerState;
  ready: boolean;
};

/** Runs in the page without registering a worker, opening a cache or changing the original readiness condition. */
export async function readOfflineReadiness(): Promise<OfflineReadinessState> {
  const supported = "serviceWorker" in navigator;
  const registration = supported ? await navigator.serviceWorker.getRegistration() : undefined;
  const worker = (value: ServiceWorker | null | undefined): WorkerState => value ? { state: value.state, scriptURL: value.scriptURL } : null;
  return {
    url: location.href,
    documentReadyState: document.readyState,
    supported,
    registration: registration ? {
      scope: registration.scope,
      installing: worker(registration.installing),
      waiting: worker(registration.waiting),
      active: worker(registration.active),
    } : null,
    controller: supported ? worker(navigator.serviceWorker.controller) : null,
    ready: registration?.active?.state === "activated",
  };
}

/** Lists names only, never cache bodies; called only when the observed readiness state changes. */
export async function readOfflineCacheNames(): Promise<string[]> {
  return "caches" in globalThis ? (await caches.keys()).sort() : [];
}

/** One fixture instance owns its fingerprint, so each test records its own first state without poll-by-poll logs. */
export function offlineReadinessProbe(
  readState: () => Promise<OfflineReadinessState>,
  readCacheNames: () => Promise<string[]>,
  report: (line: string) => void = console.warn,
): () => Promise<boolean> {
  let previous: string | undefined;
  let previousError: string | undefined;
  return async () => {
    try {
      const state = await readState();
      const fingerprint = JSON.stringify(state);
      if (fingerprint !== previous) {
        const cacheNames = await readCacheNames();
        report(`[hui.offlineFilesReady] ${JSON.stringify({ ...state, cacheNames })}`);
        previous = fingerprint;
      }
      previousError = undefined;
      return state.ready;
    } catch (error) {
      const reason = String(error);
      if (reason !== previousError) report(`[hui.offlineFilesReady] evaluation failed: ${reason}`);
      previousError = reason;
      throw error;
    }
  };
}
