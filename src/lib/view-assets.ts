/**
 * Stylesheets and page-wide helpers a view needs before the app paints.
 *
 * A view registers them while it is imported rather than awaiting them at its
 * top level. Awaiting serialized them: a module evaluates only after every
 * dependency that awaits has finished, so the chain of views cost one round
 * trip each, seconds over a slow link, before the app could even start. These
 * loads start together, and main.ts waits for all of them before the app's
 * first render, so nothing paints unstyled.
 *
 * It is meant for modules of the app's initial graph; a module imported later
 * should await what it registers. Node's view tests import these modules
 * without a CSS loader, so nothing loads there.
 */
const pending: Promise<unknown>[] = [];

export function loadViewAssets(...loads: ReadonlyArray<() => Promise<unknown>>): Promise<unknown> {
  if (typeof document === "undefined") return Promise.resolve();
  const started = Promise.all(loads.map((load) => load()));
  pending.push(started);
  return started;
}

/** Settles once everything registered so far has loaded; rejects if any failed. */
export function viewAssetsLoaded(): Promise<unknown> {
  return Promise.all(pending);
}
