/**
 * The macOS app HUI installed runs the release it was installed from, and an update replaces only the CLI and gateway.
 * An app left behind keeps the window shell it shipped with and refuses the gateway's notifications, which it only
 * reports in the gateway log. `hui update` reinstalls it; this check finds the apps earlier updates left behind, and
 * `--fix` reinstalls one from the running release. The operator quits and reopens HUI to load it.
 */
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { DoctorCheck, DoctorResult } from "./doctor-types.ts";
import { packageVersion, type Installation } from "./installation.ts";

const ID = "desktop-app";
const TITLE = "HUI desktop app";

/** What `desktop/install.mjs` knows about the installed app. The module is loaded on demand: only `cli/` and `bin/`
 * may not import `desktop/` directly, and a platform without the app never loads it. */
type DesktopApp = {
  installedAppVersion(installationRoot: string): Promise<string | null>;
  refreshInstalledApp(installationRoot: string): Promise<string | null>;
};

const describe = (version: string) => version || "without a version";

export function appCheck(installation: Installation, desktop: Promise<DesktopApp> = loadDesktop(installation.packageRoot)): DoctorCheck {
  const result = (status: DoctorResult["status"], summary: string, items: DoctorResult["items"], notes: string[]): DoctorResult =>
    ({ id: ID, title: TITLE, status, summary, items, notes });

  const inspect = async (): Promise<DoctorResult> => {
    const installed = await (await desktop).installedAppVersion(installation.installationRoot);
    if (installed === null) return result("ok", "no HUI desktop app is installed", [], []);
    const current = await packageVersion(installation.packageRoot);
    if (installed === current) return result("ok", `the desktop app and HUI are both ${current}`, [], []);
    return result("issue", `the desktop app is ${describe(installed)} and HUI is ${current}`, [
      { id: "app", label: "HUI.app", status: "issue", detail: `installed ${describe(installed)}, HUI is ${current}` },
    ], ["hui doctor --fix reinstalls the app from this release; quit and reopen HUI to load it."]);
  };

  const fix = async (): Promise<DoctorResult> => {
    const current = await packageVersion(installation.packageRoot);
    let replaced: string | null;
    try { replaced = await (await desktop).refreshInstalledApp(installation.installationRoot); }
    catch (error) {
      return result("issue", "the desktop app could not be reinstalled", [
        { id: "app", label: "HUI.app", status: "failed", detail: error instanceof Error ? error.message : String(error) },
      ], ["Install the app with hui install-app, then quit and reopen HUI."]);
    }
    if (replaced === null) return await inspect();
    return result("fixed", `reinstalled the desktop app at ${current}`, [
      { id: "app", label: "HUI.app", status: "fixed", detail: `was ${describe(replaced)}` },
    ], ["Quit and reopen HUI to load the new app."]);
  };

  return { id: ID, title: TITLE, inspect, fix };
}

async function loadDesktop(packageRoot: string): Promise<DesktopApp> {
  return await import(pathToFileURL(join(packageRoot, "desktop", "install.mjs")).href) as DesktopApp;
}