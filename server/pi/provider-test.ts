/**
 * One model verification through a connected provider account: one tiny completion on that account's runtime,
 * timed so the browser can say how fast it answered. A failure becomes a short reason and sentence, never the
 * provider's own error body, so a rejected credential or an exhausted plan is reported without echoing secrets.
 */
import { ModelsError, type Api, type AssistantMessage, type Model } from "@earendil-works/pi-ai";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { ProviderTest, ProviderTestFailure } from "../api/providers.ts";
import { quotaFailure } from "../runtimes/provider-account-routing.ts";

export type ProviderTestFailed = Extract<ProviderTest, { ok: false }>;
/** Long enough for a cold provider, short enough that nobody waits on Settings without an answer. */
export const PROVIDER_TEST_TIMEOUT_MS = 45_000;
/** One word is asked for; a small cap keeps a chatty model from streaming a page of text. */
const MAX_TOKENS = 24;
const PROMPT = "Reply with the single word OK. Do not use tools.";

/** PI's own error text for one failure, including the cause a fetch hides behind "fetch failed". */
export function failureText(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause: unknown = error.cause;
  return cause instanceof Error ? `${error.message}: ${cause.message}` : error.message;
}

/** Picks the actionable reason in one fixed order: auth, then quota, billing, time and reachability. */
export function failureReason(status: number | undefined, message: string, aborted: boolean): ProviderTestFailure {
  if (aborted) return "timeout";
  if (status === 401 || status === 403 || /unauthor|invalid.*(?:key|token)|credentials rejected/i.test(message)) return "auth";
  if (quotaFailure(status, message)) return "rate_limit";
  if (/billing|payment|credit balance/i.test(message)) return "billing";
  if (/timed? ?out|abort/i.test(message)) return "timeout";
  if ((status !== undefined && status >= 500) || /ENOTFOUND|ECONNREFUSED|ECONNRESET|EAI_AGAIN|socket hang up|fetch failed|network/i.test(message)) return "unavailable";
  return "unknown";
}

const SENTENCES: Record<ProviderTestFailure, (name: string) => string> = {
  auth: (name) => `${name} rejected the saved credentials. Sign in again.`,
  rate_limit: (name) => `${name} is rate limited right now. Try again shortly.`,
  billing: (name) => `${name} reports a billing problem. Check the account's billing.`,
  timeout: (name) => `${name} did not answer in time. Try again.`,
  format: (name) => `${name} answered without readable text. Try again.`,
  unavailable: (name) => `${name} cannot be reached right now. Check the connection and retry.`,
  unknown: (name) => `${name} could not answer this test request. Try again.`,
};

export function testFailed(reason: ProviderTestFailure, name: string): ProviderTestFailed {
  return { ok: false, reason, message: SENTENCES[reason](name) };
}

/**
 * Sends one small request to `model` through `runtime` (the account's own credentials) and measures it. PI
 * reports a failed response as an `error`/`aborted` message rather than a rejected promise, so both paths end in
 * the same classification; a rejected call is the credential or transport failing before any reply exists.
 */
export async function testProviderModel(runtime: ModelRuntime, model: Model<Api>, name: string): Promise<ProviderTest> {
  // No AbortSignal.any: the timeout signal is the only one, so an abort here is always this test's own deadline.
  const signal = AbortSignal.timeout(PROVIDER_TEST_TIMEOUT_MS);
  let status: number | undefined;
  const started = performance.now();
  let reply: AssistantMessage;
  try {
    reply = await runtime.completeSimple(model, { messages: [{ role: "user", content: [{ type: "text", text: PROMPT }], timestamp: 0 }] }, {
      signal, maxTokens: MAX_TOKENS,
      onResponse: (response) => { status = response.status; },
    });
  } catch (error) {
    if (error instanceof ModelsError && (error.code === "auth" || error.code === "oauth")) return testFailed("auth", name);
    return testFailed(failureReason(status, failureText(error), signal.aborted), name);
  }
  if (reply.stopReason === "error" || reply.stopReason === "aborted") {
    return testFailed(failureReason(status, reply.errorMessage ?? "", signal.aborted || reply.stopReason === "aborted"), name);
  }
  const text = reply.content.flatMap((part) => part.type === "text" ? [part.text] : []).join("").trim();
  if (!text) return testFailed("format", name);
  return { ok: true, latencyMs: Math.round(performance.now() - started) };
}
