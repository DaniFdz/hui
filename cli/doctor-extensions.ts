/**
 * `hui doctor`'s gateway-extension check: enabled ids with no directory, unreadable or invalid manifests, and an
 * `engines.hui` range this HUI does not satisfy. Read-only: HUI cannot repair or delete the operator's code, and the
 * check has no `--fix`.
 */
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

import { compareVersions, parseManifest, satisfiesEngines, type ExtensionManifest } from "../server/extensions/registry.ts";
import { readExtensions } from "../server/extensions/store.ts";
import { EXTENSIONS_BUNDLED_DIR, EXTENSIONS_DEFAULTS_FILE, EXTENSIONS_DIR, EXTENSIONS_FILE } from "../server/paths.ts";
import type { DoctorCheck, DoctorItem, DoctorResult } from "./doctor-types.ts";

const ID = "extensions";

/** The gateway's own version, without requiring a built release: a source checkout's package.json is enough. */
async function gatewayVersion(packageRoot: string): Promise<string> {
  try {
    const parsed = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8")) as { version?: unknown };
    return typeof parsed.version === "string" && /^\d+\.\d+\.\d+/u.test(parsed.version) ? parsed.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}
const TITLE = "Gateway extensions";

function range(min?: string, max?: string): string {
  return [min ? `>=${min}` : "", max ? `<=${max}` : ""].filter(Boolean).join(" ") || "any";
}

async function directory(path: string): Promise<boolean> {
  return (await stat(path).catch(() => undefined))?.isDirectory() === true;
}

async function enabledDefaults(file: string, defaultsFile: string): Promise<string[]> {
  if (await stat(file).then(() => true, () => false)) return [];
  try {
    const raw = JSON.parse(await readFile(defaultsFile, "utf8")) as { enabled?: unknown };
    return Array.isArray(raw.enabled) ? raw.enabled.filter((entry): entry is string => typeof entry === "string") : [];
  } catch {
    return [];
  }
}

type ManifestRead = { manifest: ExtensionManifest } | { error: string };

async function manifestAt(path: string): Promise<ManifestRead> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(join(path, "extension.json"), "utf8"));
  } catch (error) {
    return { error: `extension.json cannot be read: ${error instanceof Error ? error.message : String(error)}` };
  }
  const parsed = parseManifest(raw);
  return parsed.ok ? { manifest: parsed.value } : { error: parsed.error };
}

export function extensionsCheck(packageRoot: string, options: { dir?: string; file?: string; bundledDir?: string; defaultsFile?: string } = {}): DoctorCheck {
  const dir = options.dir ?? EXTENSIONS_DIR;
  const file = options.file ?? EXTENSIONS_FILE;
  const bundledDir = options.bundledDir ?? EXTENSIONS_BUNDLED_DIR;
  const defaultsFile = options.defaultsFile ?? EXTENSIONS_DEFAULTS_FILE;
  return {
    id: ID,
    title: TITLE,
    async inspect(): Promise<DoctorResult> {
      const version = await gatewayVersion(packageRoot);
      const store = await readExtensions(file);
      const items: DoctorItem[] = [];
      if (store.error) items.push({ id: file, label: "extensions.json", status: "issue", detail: store.error });
      const defaults = await enabledDefaults(file, defaultsFile);
      const enabled = [...new Set([...store.enabled, ...defaults])].sort();
      for (const id of enabled) {
        const userPath = join(dir, id);
        const bundledPath = join(bundledDir, id);
        const hasUser = await directory(userPath);
        const hasBundled = await directory(bundledPath);
        if (!hasUser && !hasBundled) {
          items.push({ id, label: id, status: "issue", detail: `enabled, but there is no extension directory at ${userPath} or ${bundledPath}` });
          continue;
        }
        const chosen = hasUser ? userPath : bundledPath;
        const read = await manifestAt(chosen);
        if ("error" in read) {
          items.push({ id, label: id, status: "issue", detail: hasUser ? `the config override cannot load: ${read.error}` : read.error });
          continue;
        }
        const engines = read.manifest.engines?.hui;
        if (!satisfiesEngines(engines, version)) {
          items.push({ id, label: id, status: "issue", detail: `requires HUI ${range(engines?.min, engines?.max)}; this gateway is ${version}` });
          continue;
        }
        if (hasUser && hasBundled) {
          const bundled = await manifestAt(bundledPath);
          if (!("error" in bundled) && read.manifest.version && bundled.manifest.version
            && compareVersions(read.manifest.version, bundled.manifest.version) < 0) {
            items.push({ id, label: id, status: "issue", detail: `the config copy is ${read.manifest.version}, older than the packaged ${bundled.manifest.version}; eject again to take the packaged update` });
          }
        }
      }
      return {
        id: ID,
        title: TITLE,
        status: items.length ? "issue" : "ok",
        summary: items.length ? `${items.length} enabled extension${items.length === 1 ? "" : "s"} need attention` : "Every enabled extension can load",
        items,
        notes: [],
      };
    },
  };
}
