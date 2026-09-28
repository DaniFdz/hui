import { createHash } from "node:crypto";
import { access, readFile, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

export type Installation = { installationRoot: string; packageRoot: string };
export type ReleasePointer = { format: 1; current: string | null; previous: string | null; hasPrevious: boolean };

export function updateDirectory(installationRoot: string): string {
  const id = createHash("sha256").update(installationRoot).digest("hex").slice(0, 20);
  return join(process.env["XDG_DATA_HOME"] ?? join(homedir(), ".local", "share"), "hui", "updates", id);
}

export async function readPointer(installationRoot: string): Promise<ReleasePointer> {
  let raw: string;
  try { raw = await readFile(join(updateDirectory(installationRoot), "current.json"), "utf8"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { format: 1, current: null, previous: null, hasPrevious: false };
    throw error;
  }
  const pointer = JSON.parse(raw) as ReleasePointer;
  const valid = (id: unknown) => id === null || typeof id === "string" && /^release-[a-zA-Z0-9-]+$/u.test(id);
  if (pointer.format !== 1 || !valid(pointer.current) || !valid(pointer.previous) || typeof pointer.hasPrevious !== "boolean") {
    throw new Error("Invalid HUI release pointer. Refusing to load an arbitrary path.");
  }
  return pointer;
}

export function releaseRoot(installationRoot: string, id: string | null): string {
  return id === null ? installationRoot : join(updateDirectory(installationRoot), id, "node_modules", "hui");
}

export async function packageVersion(packageRoot: string): Promise<string> {
  const pkg = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8")) as { name?: string; version?: string };
  const release = JSON.parse(await readFile(join(packageRoot, "build", "release.json"), "utf8")) as { format?: number; version?: string };
  if (pkg.name !== "hui" || !pkg.version || !/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/u.test(pkg.version)
    || release.format !== 1 || release.version !== pkg.version) throw new Error("Not a matching, built HUI release.");
  await Promise.all(["dist/index.html", "build/cli/main.js", "build/cli/gateway-run.js", "build/server/runtimes/pi-sdk-worker.js"].map((file) => access(join(packageRoot, file))));
  return pkg.version;
}

export async function assertUpdatable(root: string): Promise<void> {
  const canonical = await realpath(root);
  if (canonical.startsWith("/nix/store/")) throw new Error("This installation is managed by Nix. Update its flake/profile and rebuild; hui will not override it.");
  if (canonical.includes("/Cellar/")) throw new Error("This installation is managed by Homebrew. Update it with brew.");
  if (!isAbsolute(canonical) || !/(?:^|[/\\])node_modules[/\\]hui$/u.test(canonical)) {
    throw new Error("This is a source checkout/unmanaged installation. Build and install a package first; hui update never edits a checkout.");
  }
}
