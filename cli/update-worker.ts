import { mkdir } from "node:fs/promises";
import { updateRelease } from "./update.ts";
import { updateJobFile } from "./update-job.ts";
import { updateDirectory, type Installation } from "./installation.ts";
import { atomicJson, withLifecycleLock } from "./state.ts";
import type { UpdateJob } from "../src/lib/update-types.ts";

// Only the gateway launches this detached worker. No shell or browser-supplied
// executable/URL/arguments; it outlives the server that it needs to replace.
const installation = JSON.parse(process.argv[2]!) as Installation;
const job: UpdateJob = { id: process.argv[3]!, version: process.argv[4]!, pid: process.pid, status: "running", message: "Downloading and verifying the release…" };
let claimed = false;
try {
  await withLifecycleLock(async () => {
    await mkdir(updateDirectory(installation.installationRoot), { recursive: true, mode: 0o700 });
    await atomicJson(updateJobFile(installation.installationRoot), job);
    claimed = true;
    process.send?.({ ready: true });
    process.disconnect?.();
    const result = await updateRelease(installation, { expectedVersion: job.version });
    await atomicJson(updateJobFile(installation.installationRoot), { ...job, status: "succeeded", version: result.version, message: `HUI ${result.version} is ready.` });
  });
} catch (error) {
  const detail = error instanceof Error ? error.message : "Update failed.";
  console.error(detail);
  // Child-process errors may contain remote output. Do not echo that output to
  // the browser; retain actionable HUI-owned lifecycle/verification messages.
  const message = /^(Update requires|Release |The gateway has active|Another gateway|No stable HUI|GitHub release|Install GitHub CLI|This installation)/u.test(detail)
    ? detail : "Update failed. Check hui gateway status and logs; use hui update --rollback if recovery is needed.";
  if (claimed) await atomicJson(updateJobFile(installation.installationRoot), { ...job, status: "failed", message });
  if (process.connected) { process.send?.({ error: message }); process.disconnect?.(); }
  process.exitCode = 1;
}
