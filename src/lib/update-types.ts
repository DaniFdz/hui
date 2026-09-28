/** Gateway-owned updates; never part of a model turn or PI transcript. */
export const UPDATE_CHECK_INTERVAL_MS = 60 * 60_000;
export type ReleaseInfo = { version: string; tag: string; url: string };
export type UpdateCheck = {
  currentVersion: string | null;
  latest: ReleaseInfo | null;
  status: "available" | "current" | "unpublished" | "unavailable";
  canInstall: boolean;
  message: string;
};
export type UpdateJob = {
  id: string;
  pid: number;
  status: "running" | "succeeded" | "failed";
  version: string;
  message: string;
};
export type UpdateSnapshot = { currentVersion: string | null; check: UpdateCheck | null; job: UpdateJob | null };
