/**
 * Routes PI's model requests across the provider accounts connected in HUI. Each request is pinned to one
 * account's credentials, moves to the next account when a quota error arrives before any output, and puts the
 * exhausted account on cooldown. Once a response has started streaming it is never replayed elsewhere.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { findPackageJSON } from "node:module";
import { pathToFileURL } from "node:url";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { credentialStore, ProviderAccounts, type CredentialStore } from "../pi/provider-accounts.ts";

type Stream = ReturnType<ModelRuntime["streamSimple"]>;
type StreamArgs = Parameters<ModelRuntime["streamSimple"]>;
type Event = Stream extends AsyncIterable<infer E> ? E : never;
// Reuse the pinned SDK's stream implementation, without adding a second PI version.
const piAiPackage = findPackageJSON("@earendil-works/pi-ai", import.meta.resolve("@earendil-works/pi-coding-agent"))!;
const { AssistantMessageEventStream } = await import(new URL("./dist/utils/event-stream.js", pathToFileURL(piAiPackage)).href) as { AssistantMessageEventStream: new() => Stream };

export function quotaFailure(status: number | undefined, message = ""): boolean {
  if (/\b(?:rate_limit_exceeded|insufficient_quota|usage_limit_reached|quota_exceeded)\b|\b(?:rate|usage|quota) limit (?:reached|exceeded)\b/i.test(message)) return true;
  // A provider can use 429 for its own capacity, not this account's quota. Rotating
  // or cooling the account cannot help and would block its other models too.
  if (/\b(?:prefill_cap_refused|at capacity|overloaded)\b/i.test(message)) return false;
  return status === 429 || /\b429\b/.test(message);
}
/** A provider-requested delay, without the 60-second default a cooldown needs. */
export function retryDelayHint(headers: Record<string, string>, now = Date.now(), message = ""): number | undefined {
  const milliseconds = Number(headers["retry-after-ms"]);
  if (Number.isFinite(milliseconds) && milliseconds > 0) return milliseconds;
  const seconds = Number(headers["retry-after"]);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = headers["retry-after"] === undefined ? NaN : Date.parse(headers["retry-after"]);
  if (Number.isFinite(date) && date > now) return date - now;
  const minutes = /(?:try again|retry) in ~?(\d+) min/i.exec(message);
  if (minutes) return Number(minutes[1]) * 60_000;
  const afterSeconds = /(?:after|in)\s+(\d+)\s*(?:s|sec|seconds?)\b/i.exec(message);
  if (afterSeconds) return Number(afterSeconds[1]) * 1000;
  return undefined;
}
export function retryAt(headers: Record<string, string>, now = Date.now(), message = ""): number {
  const hint = retryDelayHint(headers, now, message);
  return hint === undefined ? now + 60_000 : now + Math.max(1, hint);
}

export async function accountRouting(accounts: ProviderAccounts, routing: { onRetryHint?: (delayMs: number) => void } = {}) {
  // Each request pins its account across async OAuth read/modify/refresh. No
  // process-global active key: concurrent sessions cannot refresh another account.
  const initialAccounts = await accounts.all();
  const scope = new AsyncLocalStorage<{ provider: string; account: string }>();
  const store = (id: string) => credentialStore(accounts.authPath(id));
  const chosen = async (provider: string) => {
    const pinned = scope.getStore();
    if (pinned?.provider === provider) return pinned.account;
    for (const account of initialAccounts[provider] ?? []) if (await store(account.id).read(provider)) return account.id;
    return "default";
  };
  const credentials: CredentialStore = {
    read: async (id, options) => store(await chosen(id)).read(id, options),
    modify: async (id, fn, options) => store(await chosen(id)).modify(id, fn, options),
    delete: async (id, options) => store(await chosen(id)).delete(id, options),
    // Only used for catalog availability; stream routing re-reads durable order.
    list: async (options) => {
      const result: Awaited<ReturnType<CredentialStore["list"]>>[number][] = [];
      for (const [provider, entries] of Object.entries(initialAccounts)) {
        for (const account of entries) {
          const entry = (await store(account.id).list(options)).find((item) => item.providerId === provider);
          if (entry) { result.push(entry); break; }
        }
      }
      return result;
    },
  };
  function install(runtime: ModelRuntime, managed: ReadonlySet<string>) {
    const wrap = (original: ModelRuntime["streamSimple"]): ModelRuntime["streamSimple"] => (model, context, options) => {
      if (!managed.has(model.provider) || options?.apiKey) return original(model, context, options);
      const output = new AssistantMessageEventStream();
      void (async () => {
        const entries = await accounts.list(model.provider);
        if (!entries.length) {
          throw new Error("No provider accounts are connected. Sign in in Settings → Models.");
        }
        const tried = new Set<string>();
        let lastError: Extract<Event, { type: "error" }> | undefined;
        for (;;) {
          options?.signal?.throwIfAborted();
          const available = (await accounts.list(model.provider)).filter((a) => entries.some((initial) => initial.id === a.id) && !tried.has(a.id) && (a.cooldownUntil ?? 0) <= Date.now());
          const account = available[0];
          if (!account) {
            if (lastError) { output.push(lastError); return; }
            throw new Error("All provider accounts are waiting for their quota to reset. Check account limits in Settings → Models.");
          }
          tried.add(account.id);
          if (!await store(account.id).read(model.provider)) continue;
          let status: number | undefined;
          let headers: Record<string, string> = {};
          let emitted = false;
          const buffered: Event[] = [];
          const requestOptions: StreamArgs[2] = {
            ...options, maxRetries: 0,
            // PI websocket connection caches are keyed by session. Keep the
            // affinity account-specific so a rotated token never reuses a socket.
            ...(options?.sessionId ? { sessionId: `${options.sessionId}:${account.id}` } : {}),
            onResponse: async (response, currentModel) => {
              status = response.status;
              headers = Object.fromEntries(Object.entries(response.headers).map(([k, v]) => [k.toLowerCase(), v]));
              await options?.onResponse?.(response, currentModel);
            },
          };
          const stream = scope.run({ provider: model.provider, account: account.id }, () => original(model, context, requestOptions));
          let retry = false;
          for await (const event of stream) {
            if (event.type === "error" && event.reason !== "aborted" && !options?.signal?.aborted && quotaFailure(status, event.error.errorMessage)) {
              await accounts.cooldown(model.provider, account.id, retryAt(headers, Date.now(), event.error.errorMessage));
              if (!emitted && !event.error.content.length) { lastError = event; retry = true; break; }
            }
            // The pre-content capacity errors are retried by the Durable harness. Tell it how
            // long the provider asked us to wait so it keeps the model and its cached context.
            if (event.type === "error" && event.reason !== "aborted" && !options?.signal?.aborted
              && (status === 429 || (status ?? 0) >= 500 || /\b(?:prefill_cap_refused|at capacity|overloaded)\b/i.test(event.error.errorMessage ?? ""))
              && !quotaFailure(status, event.error.errorMessage)) {
              const hint = retryDelayHint(headers, Date.now(), event.error.errorMessage ?? "");
              if (hint !== undefined) routing.onRetryHint?.(Math.min(hint, 60_000));
            }
            // Hold only the empty start event. Once any content/tool/thinking
            // event is emitted, never replay this request with another account.
            if (event.type === "start" && !event.partial.content.length) { buffered.push(event); continue; }
            for (const start of buffered.splice(0)) output.push(start);
            emitted = true;
            output.push(event);
          }
          if (!retry) return;
        }
      })().catch((error: unknown) => {
        output.push({ type: "error", reason: options?.signal?.aborted ? "aborted" : "error", error: {
          role: "assistant", content: [], api: model.api, provider: model.provider, model: model.id,
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
          stopReason: options?.signal?.aborted ? "aborted" : "error", timestamp: Date.now(),
          errorMessage: error instanceof Error ? error.message : "Provider account routing failed.",
        } });
      }).finally(() => output.end());
      return output;
    };
    runtime.streamSimple = wrap(runtime.streamSimple.bind(runtime));
    runtime.stream = wrap(runtime.stream.bind(runtime)) as ModelRuntime["stream"];
  }
  return { credentials, install };
}
