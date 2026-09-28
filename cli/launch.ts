import { realpath } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { readPointer, releaseRoot } from "./installation.ts";

export async function launch(root: string, args: string[]): Promise<void> {
  const installationRoot = await realpath(root);
  const pointer = await readPointer(installationRoot);
  // Recovery always uses the originally installed CLI, even if an activated
  // release can no longer import its own command implementation.
  const packageRoot = args[0] === "update" && args.includes("--rollback")
    ? installationRoot : releaseRoot(installationRoot, pointer.current);
  const { main } = await import(pathToFileURL(join(packageRoot, "build/cli/main.js")).href);
  await main(args, { installationRoot, packageRoot });
}
