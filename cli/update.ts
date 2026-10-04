import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import { blockingSessions, gatewayStatus, startGateway, stopGateway } from "./gateway.ts";
import { atomicJson } from "./state.ts";
import { assertUpdatable, packageVersion, readPointer, releaseRoot, updateDirectory, type Installation, type ReleasePointer } from "./installation.ts";
import { downloadRelease, latestRelease, newerVersion } from "./releases.ts";

const exec = promisify(execFile);

/** Boot against an empty, disposable configuration, never against live user
 * sessions. This checks compiled imports, HTTP API and built web assets. */
export async function probeRelease(candidate: string, fallback: string): Promise<void> {
  const temporary = await mkdtemp(join(tmpdir(), "hui-release-probe-"));
  const env = { ...process.env, XDG_CONFIG_HOME: join(temporary, "config"), XDG_DATA_HOME: join(temporary, "data"),
    PI_CODING_AGENT_DIR: join(temporary, "agent"), HUI_PI_BACKEND: "sdk" };
  try {
    const { stdout } = await exec(process.execPath, [join(candidate, "bin/hui.mjs"), "gateway", "start", "--port", "0", "--json"], { env, timeout: 30_000 });
    const status = JSON.parse(stdout) as { status?: string; url?: string; version?: string };
    if (status.status !== "running" || status.version !== await packageVersion(candidate) || !status.url) throw new Error("Candidate did not report a healthy gateway.");
    const page = await fetch(status.url, { signal: AbortSignal.timeout(5_000), redirect: "error" });
    if (!page.ok || !(await page.text()).includes("<hui-app")) throw new Error("Candidate web assets failed validation.");
    const health = await fetch(new URL("/__hui/health", status.url), { headers: { "x-hui": "1" }, signal: AbortSignal.timeout(5_000) });
    if (!health.ok || (await health.json() as { status?: string }).status !== "online") throw new Error("Candidate API failed validation.");
  } finally {
    // Recovery uses the known-good original CLI, not the candidate's stop code.
    await exec(process.execPath, [join(fallback, "bin/hui.mjs"), "gateway", "stop", "--force"], { env, timeout: 20_000 });
    await rm(temporary, { recursive: true, force: true });
  }
}

export async function updateRelease(installation: Installation, options: { from?: string; sha256?: string; rollback?: boolean; expectedVersion?: string }): Promise<{ version: string; sha256?: string; restarted: boolean }> {
  await assertUpdatable(installation.installationRoot);
  const status = await gatewayStatus();
  if (status.status === "unresponsive" || blockingSessions(status) || status.activeTerminals) throw new Error("Update requires a stopped or healthy idle gateway. Finish active sessions and terminals first.");
  if (!options.from && !options.rollback) {
    const release = await latestRelease();
    if (options.expectedVersion && release.version !== options.expectedVersion) throw new Error("Release changed since checking. Check for updates again before installing.");
    const current = await packageVersion(installation.packageRoot);
    if (!newerVersion(release.version, current)) return { version: current, restarted: false };
    const downloaded = await downloadRelease(release);
    try { return await updateRelease(installation, { from: downloaded.path, sha256: downloaded.sha256, expectedVersion: release.version }); }
    finally { await downloaded.dispose(); }
  }
  const directory = updateDirectory(installation.installationRoot);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const old = await readPointer(installation.installationRoot);
  let next: ReleasePointer;
  let sha256: string | undefined;
  if (options.rollback) {
    if (!old.hasPrevious) throw new Error("There is no previous release to restore.");
    next = { format: 1, current: old.previous, previous: old.current, hasPrevious: true };
  } else {
    if (!options.from) throw new Error("A local release archive is required.");
    const archive = await realpath(options.from);
    const info = await stat(archive);
    if (!info.isFile() || !archive.endsWith(".tgz") || info.size > 100 * 1024 * 1024) throw new Error("Expected a local .tgz release smaller than 100 MiB.");
    sha256 = createHash("sha256").update(await readFile(archive)).digest("hex");
    if (options.sha256 && options.sha256.toLowerCase() !== sha256) throw new Error("Release SHA-256 does not match. Nothing was installed.");
    const stage = await mkdtemp(join(directory, "release-"));
    try {
      await exec(process.platform === "win32" ? "npm.cmd" : "npm", ["install", "--prefix", stage, "--omit=dev", "--ignore-scripts", "--no-bin-links", "--no-audit", "--no-fund", "--package-lock=false", "--save-exact", archive], { timeout: 180_000, maxBuffer: 1024 * 1024 });
      const version = await packageVersion(join(stage, "node_modules", "hui"));
      if (options.expectedVersion && version !== options.expectedVersion) throw new Error("Release package version does not match its GitHub tag.");
      next = { format: 1, current: basename(stage), previous: old.current, hasPrevious: true };
    } catch (error) {
      await rm(stage, { recursive: true, force: true }); throw error;
    }
  }
  const candidate = releaseRoot(installation.installationRoot, next.current);
  const version = await packageVersion(candidate);
  await probeRelease(candidate, installation.installationRoot);
  // Stop rechecks activity atomically at the gateway after the potentially
  // lengthy install/probe; a new turn during staging cancels activation.
  const previousGateway = await stopGateway();
  const pointerFile = join(directory, "current.json");
  try {
    await atomicJson(pointerFile, next);
    if (previousGateway) await startGateway({ ...previousGateway, packageRoot: candidate, installationRoot: installation.installationRoot });
  } catch (error) {
    await atomicJson(pointerFile, old);
    if (previousGateway) {
      try { await startGateway({ ...previousGateway, packageRoot: previousGateway.packageRoot, installationRoot: installation.installationRoot }); }
      catch (restore) { throw new Error(`Activation failed and the previous gateway could not restart: ${String(restore)}. The previous release pointer was restored.`); }
    }
    throw error;
  }
  return { version, ...(sha256 ? { sha256 } : {}), restarted: Boolean(previousGateway) };
}
