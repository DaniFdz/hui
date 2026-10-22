/** HUI connections overlay PI's runtime without writing PI configuration, and its models.json `!command` keys run
 * without blocking the process. */
import { exec } from "node:child_process";
import { readFile, mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { ModelRuntime, type ModelRuntimeAuthOverrides } from "@earendil-works/pi-coding-agent";
import { credentialStore, type CredentialStore, ProviderAccounts } from "../pi/provider-accounts.ts";
import { accountRouting } from "./provider-account-routing.ts";
import { CONFIG_DIR } from "../paths.ts";

/** A remote worker points its PI processes at the mirrored HUI providers. */
export const PROVIDERS_DIR = process.env["HUI_PROVIDERS_DIR"] || join(CONFIG_DIR, "providers");
export type ProviderSelections = Record<string, { models: string[] }>;
export async function readProviderSelections(dir = PROVIDERS_DIR): Promise<ProviderSelections> {
  let raw: unknown;
  try { raw = JSON.parse(await readFile(join(dir, "models.json"), "utf8")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return {}; throw new Error("HUI provider configuration could not be read."); }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Invalid HUI provider configuration.");
  const result: ProviderSelections = {};
  for (const [id, entry] of Object.entries(raw)) {
    if (!entry || !Array.isArray(entry.models) || !entry.models.every((id: unknown) => typeof id === "string")) throw new Error("Invalid HUI model selection.");
    Object.defineProperty(result, id, { value: { models: entry.models }, enumerable: true, configurable: true, writable: true });
  }
  return result;
}

export async function writeProviderSelections(selections: ProviderSelections, dir = PROVIDERS_DIR) {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const temporary = join(dir, `models.${randomUUID()}.tmp`);
  await writeFile(temporary, JSON.stringify(selections, null, 2) + "\n", { mode: 0o600 });
  await rename(temporary, join(dir, "models.json"));
}

const execAsync = promisify(exec);
type AuthTarget = string | Parameters<ModelRuntime["getAuth"]>[0];

async function keyCommands(agentDir: string, selections: ProviderSelections): Promise<Map<string, string>> {
  let providers: unknown;
  try { providers = (JSON.parse(await readFile(join(agentDir, "models.json"), "utf8")) as { providers?: unknown }).providers; }
  catch { return new Map(); }
  return new Map(Object.entries(providers ?? {}).flatMap(([id, config]) => {
    const key: unknown = (config as { apiKey?: unknown } | null)?.apiKey;
    return typeof key === "string" && key.startsWith("!") && !Object.hasOwn(selections, id) ? [[id, key.slice(1)] as const] : [];
  }));
}

/** PI runs a models.json `!command` API key with execSync on every request (earendil-works/pi#11186). Durable
 * sessions share the gateway's event loop, so each run froze every session and browser request, for seconds when
 * the command is a token CLI. Run it per request as PI does, without blocking. On Windows PI picks a configured
 * shell, so it keeps its own run there. */
function runKeyCommandsAsync(runtime: ModelRuntime, commands: ReadonlyMap<string, string>): ModelRuntime {
  if (process.platform === "win32") return runtime;
  const getAuth = runtime.getAuth.bind(runtime) as (target: AuthTarget, overrides?: ModelRuntimeAuthOverrides) => ReturnType<ModelRuntime["getAuth"]>;
  runtime.getAuth = (async (target: AuthTarget, overrides: ModelRuntimeAuthOverrides = {}) => {
    const provider = typeof target === "string" ? target : target.provider;
    const command = commands.get(provider);
    if (command === undefined || overrides.apiKey !== undefined || runtime.getProviderAuthStatus(provider).source === "stored") return getAuth(target, overrides);
    const run = execAsync(command, { timeout: 10_000 });
    run.child.stdin?.end();
    const apiKey = await run.then(({ stdout }) => stdout.trim(), () => "");
    if (!apiKey) throw new Error(`Failed to resolve API key for provider "${provider}" from shell command: ${command}`);
    return getAuth(target, { ...overrides, apiKey });
  }) as ModelRuntime["getAuth"];
  return runtime;
}

export function createHuiModelRuntime(dir = PROVIDERS_DIR) {
  return ModelRuntime.create({ authPath: join(dir, "auth.json"), modelsPath: null, allowModelNetwork: false });
}

/** Compose the already-resolved PI providers with managed built-ins in a clean
 * registry. Re-registering into PI's original registry would reapply models.json
 * overrides, potentially routing HUI credentials to the wrong endpoint. */
export async function createSessionModelRuntime(agentDir: string, dir = PROVIDERS_DIR) {
  const selections = await readProviderSelections(dir);
  const pi = await ModelRuntime.create({ credentials: credentialStore(join(agentDir, "auth.json")), modelsPath: join(agentDir, "models.json") });
  const commands = await keyCommands(agentDir, selections);
  if (!Object.keys(selections).length) return runKeyCommandsAsync(pi, commands);
  const managed = await createHuiModelRuntime(dir);
  const accounts = new ProviderAccounts(dir);
  const routing = await accountRouting(accounts);
  const huiStore = routing.credentials;
  const piStore = credentialStore(join(agentDir, "auth.json"));
  const store = (id: string) => Object.hasOwn(selections, id) ? huiStore : piStore;
  const credentials: CredentialStore = {
    read: (id, options) => store(id).read(id, options),
    modify: (id, fn, options) => store(id).modify(id, fn, options),
    delete: (id, options) => store(id).delete(id, options),
    list: async (options) => [
      ...(await huiStore.list(options)).filter((entry) => Object.hasOwn(selections, entry.providerId)),
      ...(await piStore.list(options)).filter((entry) => !Object.hasOwn(selections, entry.providerId)),
    ],
  };
  const combined = await ModelRuntime.create({ credentials, modelsPath: null, refreshOnCreate: false });
  for (const provider of pi.getProviders()) {
    if (!Object.hasOwn(selections, provider.id)) combined.registerNativeProvider(provider);
  }
  for (const id of Object.keys(selections)) {
    const provider = managed.getProvider(id);
    if (!provider) throw new Error(`Unknown HUI provider: ${id}`);
    combined.registerNativeProvider(provider);
  }
  routing.install(combined, new Set(Object.keys(selections)));
  await combined.refresh({ allowNetwork: false });
  return runKeyCommandsAsync(combined, commands);
}
