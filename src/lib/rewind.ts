import type { RuntimeCheckpoint } from "./sessions-store.ts";

export type RewindTarget = {
  kind: RuntimeCheckpoint["kind"];
  occurrence: number;
};

/** Resolve a visible active-branch block to the matching PI tree checkpoint. */
export function checkpointForTarget(
  checkpoints: readonly RuntimeCheckpoint[],
  target: RewindTarget | undefined,
): RuntimeCheckpoint | undefined {
  if (!target) return undefined;
  return checkpoints.filter((point) => point.current && point.kind === target.kind)[target.occurrence];
}
