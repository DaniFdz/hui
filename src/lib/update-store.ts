import { fetchJson } from "./settings-store.ts";
import type { UpdateSnapshot } from "./update-types.ts";

export const loadUpdate = () => fetchJson<UpdateSnapshot>("/__hui/update");
export const checkUpdate = () => fetchJson<UpdateSnapshot>("/__hui/update/check", { method: "POST", signal: AbortSignal.timeout(30_000) });
export const checkUpdateInBackground = () => fetchJson<UpdateSnapshot>("/__hui/update/check", { signal: AbortSignal.timeout(30_000) });
export const installUpdate = (version: string) => fetchJson<UpdateSnapshot>("/__hui/update", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ version }), signal: AbortSignal.timeout(15_000),
});
