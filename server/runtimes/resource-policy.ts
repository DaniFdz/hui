/**
 * Applies HUI's per-resource switches to PI packages and extensions. Resources get stable hashed IDs, and the SDK
 * reads an in-memory settings copy without the disabled ones; PI's own settings files are never modified.
 */
import { createHash } from "node:crypto";

import { SettingsManager } from "@earendil-works/pi-coding-agent";

export type ConfiguredResourceKind = "package" | "extension";
export type ResourceIdentityKind = ConfiguredResourceKind | "skill";

type PiSettings = ReturnType<SettingsManager["getGlobalSettings"]>;
type SettingsScope = "global" | "project";

export function configuredResourceId(kind: ResourceIdentityKind, source: string): string {
  return createHash("sha256").update(`hui:${kind}\0${source}`).digest("hex").slice(0, 24);
}

function packageSource(entry: NonNullable<PiSettings["packages"]>[number]): string {
  return typeof entry === "string" ? entry : entry.source;
}

export function filterDisabledResources(settings: PiSettings, disabledIds: ReadonlySet<string>): PiSettings {
  if (!disabledIds.size) return structuredClone(settings);
  return {
    ...structuredClone(settings),
    ...(settings.packages
      ? { packages: settings.packages.filter((entry) =>
          !disabledIds.has(configuredResourceId("package", packageSource(entry)))) }
      : {}),
    ...(settings.extensions
      ? { extensions: settings.extensions.filter((source) =>
          !disabledIds.has(configuredResourceId("extension", source))) }
      : {}),
  };
}

/** Build a process-local PI settings view. The SDK discovers resources from
 * this filtered copy, so disabled package code is never imported. PI's files
 * remain the source of truth and are never rewritten. */
export function createPolicySettingsManager(options: {
  cwd: string;
  agentDir: string;
  disabledIds: ReadonlySet<string>;
}): SettingsManager {
  const disk = SettingsManager.create(options.cwd, options.agentDir);
  const values: Record<SettingsScope, PiSettings> = {
    global: filterDisabledResources(disk.getGlobalSettings(), options.disabledIds),
    project: filterDisabledResources(disk.getProjectSettings(), options.disabledIds),
  };
  const storage = {
    withLock(scope: SettingsScope, operation: (current: string | undefined) => string | undefined) {
      const next = operation(JSON.stringify(values[scope]));
      if (next !== undefined) values[scope] = JSON.parse(next) as PiSettings;
    },
  };
  return SettingsManager.fromStorage(storage, { projectTrusted: disk.isProjectTrusted() });
}
