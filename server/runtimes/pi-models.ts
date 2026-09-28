import { readProviderSelections, type ProviderSelections } from "./hui-models.ts";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { RuntimeModel } from "./types.ts";

type ConfiguredModels = ReadonlyMap<string, "all" | ReadonlySet<string>>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Mirror the model-name extension's selection rules, not an access policy.
 * Empty/missing model lists (or lists without string IDs) keep the provider.
 * An empty providers object intentionally selects no models. */
export function configuredModels(raw: unknown): ConfiguredModels | undefined {
  if (!isRecord(raw)) return undefined;
  const providers = raw["providers"] ?? {};
  if (!isRecord(providers)) return undefined;
  return new Map(Object.entries(providers).map(([provider, config]) => {
    const models = isRecord(config) ? config["models"] : undefined;
    const ids = new Set(Array.isArray(models)
      ? models.flatMap((model) => isRecord(model) && typeof model["id"] === "string" ? [model["id"]] : [])
      : []);
    return [provider, ids.size ? ids : "all"];
  }));
}

/** Read only provider names and IDs into the projection. Never expose raw
 * models.json: it may contain credentials, URLs and transport configuration. */
export async function filterConfiguredModels(
  models: readonly RuntimeModel[],
  agentDir: string,
  managed?: ProviderSelections,
): Promise<readonly RuntimeModel[]> {
  const selections = managed ?? await readProviderSelections();
  let allowlist: ConfiguredModels | undefined;
  try {
    allowlist = configuredModels(JSON.parse(await readFile(join(agentDir, "models.json"), "utf8")));
  } catch {
    // Missing/malformed PI selection retains the normal PI catalog.
  }
  return models.filter((model) => {
    const selected = Object.hasOwn(selections, model.provider) ? selections[model.provider] : undefined;
    if (selected) return selected.models.includes(model.id);
    if (!allowlist) return true;
    const entry = allowlist.get(model.provider);
    return entry === "all" || (entry?.has(model.id) ?? false);
  });
}
