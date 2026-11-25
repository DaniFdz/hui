/** Offline-worker diagnostics: bounded lifecycle observation, read-only state readers and per-test change logs. */
/** Installed before boot in offline browser tests only; observes the original register call without replacing its Promise.
 * Extra observation callbacks can affect a race's timing: these logs diagnose it, never repair it. */
export function observeOfflineLifecycle(): void {
  if (!("serviceWorker" in navigator)) return;
  const container = navigator.serviceWorker;
  const original = container.register;
  const registrations = new WeakSet<ServiceWorkerRegistration>();
  const workers = new WeakSet<ServiceWorker>();
  let events = 0;
  let previous: string | undefined;
  const scriptName = (url: string) => { const parsed = new URL(url, location.href); return parsed.origin + parsed.pathname; };
  const emit = (event: Record<string, unknown>) => {
    if (events >= 64) return;
    const encoded = JSON.stringify(event);
    if (encoded === previous) return;
    previous = encoded;
    events++;
    console.warn(`[hui.offlineLifecycle] ${encoded}`);
  };
  const errorDetail = (error: unknown) => ({ name: error instanceof Error ? error.name : typeof error, message: error instanceof Error ? error.message : String(error) });
  const watchWorker = (worker: ServiceWorker | null, scope: string) => {
    if (!worker || workers.has(worker)) return;
    workers.add(worker);
    const state = () => emit({ event: "worker-state", scope, script: scriptName(worker.scriptURL), state: worker.state });
    worker.addEventListener("statechange", state);
    worker.addEventListener("error", (event) => emit({ event: "worker-error", scope, script: scriptName(worker.scriptURL), name: "ErrorEvent", message: (event as ErrorEvent).message ?? event.type }));
    state();
  };
  const watchRegistration = (registration: ServiceWorkerRegistration) => {
    if (registrations.has(registration)) return;
    registrations.add(registration);
    const scope = scriptName(registration.scope);
    const update = () => {
      emit({ event: "registration", scope, installing: registration.installing?.state ?? null, waiting: registration.waiting?.state ?? null, active: registration.active?.state ?? null });
      for (const worker of [registration.installing, registration.waiting, registration.active]) watchWorker(worker, scope);
    };
    registration.addEventListener("updatefound", update);
    update();
  };
  container.addEventListener("controllerchange", () => {
    const worker = container.controller;
    emit({ event: "controller", state: worker?.state ?? null, script: worker ? scriptName(worker.scriptURL) : null });
  });
  container.register = function (this: ServiceWorkerContainer, ...args: Parameters<ServiceWorkerContainer["register"]>) {
    let promise: Promise<ServiceWorkerRegistration>;
    try {
      promise = Reflect.apply(original, this, args) as Promise<ServiceWorkerRegistration>;
    } catch (error) {
      emit({ event: "register-threw", ...errorDetail(error) });
      throw error;
    }
    void promise.then((registration) => {
      try { watchRegistration(registration); } catch (error) { emit({ event: "observer-error", ...errorDetail(error) }); }
    }, (error: unknown) => emit({ event: "register-rejected", ...errorDetail(error) }));
    return promise;
  };
}

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
