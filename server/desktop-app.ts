/** Opening a chat in the HUI desktop app, which is what a `?open=app` link asks for: the app is HUI's own bundle,
 * found and trusted the same way `notify_user` finds it, and it opens the chat through the `hui://` scheme. */
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const APP_OWNER = "org.harnessui.desktop";

/** The app bundle HUI installed here, or nothing when this host has none or owns a different one. */
async function installedAppBundle(): Promise<string | undefined> {
  if (platform() !== "darwin") return;
  const bundle = join(homedir(), "Applications", "HUI.app");
  const owner = await readFile(join(bundle, "Contents", "Resources", "hui-owner"), "utf8").catch(() => "");
  return owner === APP_OWNER ? bundle : undefined;
}

/** Bring the app forward on a chat this gateway serves: `/sessions/<id>` or `/bots/<id>`. */
export async function openChatInApp(path: string): Promise<void> {
  const [, kind, id] = path.split("/");
  const bundle = await installedAppBundle();
  if (!bundle) throw new Error("The HUI desktop app is not installed on this machine.");
  await promisify(execFile)("/usr/bin/open", ["-a", bundle, `hui://${kind}/${id}`], { timeout: 10_000 });
}
