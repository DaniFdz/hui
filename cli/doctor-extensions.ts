/**
 * `hui doctor`'s gateway-extension check: enabled ids with no directory, unreadable or invalid manifests, and an
 * `engines.hui` range this HUI does not satisfy. Read-only: HUI cannot repair or delete the operator's code, and the
 * check has no `--fix`.
 */
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

import { parseManifest, satisfiesEngines } from "../server/extensions/registry.ts";
import { readExtensions } from "../server/extensions/store.ts";
import { EXTENSIONS_DIR, EXTENSIONS_FILE } from "../server/paths.ts";
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

export function extensionsCheck(packageRoot: string, options: { dir?: string; file?: string } = {}): DoctorCheck {
  const dir = options.dir ?? EXTENSIONS_DIR;
  const file = options.file ?? EXTENSIONS_FILE;
  return {
    id: ID,
    title: TITLE,
    async inspect(): Promise<DoctorResult> {
      const version = await gatewayVersion(packageRoot);
      const store = await readExtensions(file);
      const items: DoctorItem[] = [];
      if (store.error) items.push({ id: file, label: "extensions.json", status: "issue", detail: store.error });
      for (const id of store.enabled) {
        const path = join(dir, id);
        const info = await stat(path).catch(() => undefined);
        if (!info?.isDirectory()) {
          items.push({ id, label: id, status: "issue", detail: `enabled, but there is no extension directory at ${path}` });
          continue;
        }
        let raw: unknown;
        try {
          raw = JSON.parse(await readFile(join(path, "extension.json"), "utf8"));
        } catch (error) {
          items.push({ id, label: id, status: "issue", detail: `extension.json cannot be read: ${error instanceof Error ? error.message : String(error)}` });
          continue;
        }
        const manifest = parseManifest(raw);
        if (!manifest.ok) {
          items.push({ id, label: id, status: "issue", detail: manifest.error });
          continue;
        }
        const engines = manifest.value.engines?.hui;
        if (!satisfiesEngines(engines, version)) {
          items.push({ id, label: id, status: "issue", detail: `requires HUI ${range(engines?.min, engines?.max)}; this gateway is ${version}` });
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
