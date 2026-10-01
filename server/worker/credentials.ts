/**
 * Credential stores for a PI worker running on a remote host. Reads and
 * writes go to the connected gateway over the worker's IPC channel; an OAuth
 * refresh runs here while the gateway holds its own file lock, so a rotated
 * token is written exactly once, on the gateway. Without a gateway the
 * remote's own PI login is used.
 */
import { join, relative } from "node:path";
import { fileCredentialStore, setCredentialStoreFactory, type CredentialStore } from "../provider-accounts.ts";

type Credential = Awaited<ReturnType<CredentialStore["read"]>>;
type Modifier = (current: Credential) => Promise<Credential>;

class OfflineError extends Error {}

const pending = new Map<string, { resolve(value: unknown): void; reject(error: Error): void }>();
const modifiers = new Map<string, Modifier>();
let next = 0;
let listening = false;

function listen(): void {
  if (listening) return;
  listening = true;
  process.on("message", (raw: unknown) => {
    if (!raw || typeof raw !== "object") return;
    const message = raw as Record<string, unknown>;
    const id = typeof message["id"] === "string" ? message["id"] : "";
    if (message["type"] === "credential-result") {
      const request = pending.get(id);
      if (!request) return;
      pending.delete(id);
      if (message["ok"] === true) request.resolve(message["result"]);
      else request.reject(message["offline"] === true ? new OfflineError("HUI is not connected.") : new Error(String(message["error"] ?? "Credential request failed.")));
      return;
    }
    if (message["type"] === "credential-step") {
      const modify = modifiers.get(id);
      const reply = (body: Record<string, unknown>) => process.send?.({ version: 1, type: "credential-step-result", step: message["step"], ...body });
      if (!modify) { reply({ ok: false, error: "That credential update is no longer pending." }); return; }
      modify(message["current"] as Credential).then(
        (value) => reply({ ok: true, ...(value === undefined ? {} : { next: value }) }),
        (error: unknown) => reply({ ok: false, error: error instanceof Error ? error.message : String(error) }),
      );
    }
  });
}

function call(op: string, store: string, providerId?: string, modify?: Modifier): Promise<unknown> {
  listen();
  if (!process.send) return Promise.reject(new OfflineError("No worker host."));
  const id = `c${++next}`;
  if (modify) modifiers.set(id, modify);
  return new Promise<unknown>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    process.send!({ version: 1, type: "credential", id, op, store, ...(providerId ? { providerId } : {}) });
  }).finally(() => modifiers.delete(id));
}

export function brokeredStore(store: string, fallback: () => CredentialStore): CredentialStore {
  let local: CredentialStore | undefined;
  const offline = () => (local ??= fallback());
  const attempt = async <T>(remote: () => Promise<T>, fallbackCall: (store: CredentialStore) => Promise<T>): Promise<T> => {
    try { return await remote(); } catch (error) {
      if (error instanceof OfflineError) return fallbackCall(offline());
      throw error;
    }
  };
  return {
    read: (providerId, options) => attempt(() => call("read", store, providerId) as Promise<Credential>, (s) => s.read(providerId, options)),
    list: (options) => attempt(async () => (await call("list", store)) as Awaited<ReturnType<CredentialStore["list"]>>, (s) => s.list(options)),
    delete: (providerId, options) => attempt(async () => { await call("delete", store, providerId); }, (s) => s.delete(providerId, options)),
    modify: (providerId, fn, options) => attempt(() => call("modify", store, providerId, fn) as Promise<Credential>, (s) => s.modify(providerId, fn, options)),
  };
}

/** HUI provider credential files a gateway serves, relative to its providers dir. */
export const BROKERED_PROVIDER_FILE = /^(?:auth\.json|accounts\/[0-9a-f-]{36}\/auth\.json)$/u;

/** Maps the credential files a PI worker opens to gateway-side store names. */
export function installBrokeredCredentials(options: { agentDir: string; providersDir: string; fallbackAuth: string }): void {
  setCredentialStoreFactory((path) => {
    if (path === join(options.agentDir, "auth.json")) return brokeredStore("pi", () => fileCredentialStore(options.fallbackAuth));
    const rel = relative(options.providersDir, path).split("\\").join("/");
    if (BROKERED_PROVIDER_FILE.test(rel)) return brokeredStore(`hui:${rel}`, () => fileCredentialStore(path));
    return fileCredentialStore(path);
  });
}
