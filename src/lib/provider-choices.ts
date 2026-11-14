/**
 * The provider setup wizard's rules and copy: the featured brands and the hints their methods produce, the sign-in
 * method labels and hints, which flow HUI picks and how the other one is offered, the paste-field copy, the sentences
 * for a stopped sign-in or a failed model check, a device code's remaining life, and what the model step saves. PI
 * owns the providers and credentials; this module only names, describes and adds up what the wizard shows.
 */
import type {
  ProviderLogin,
  ProviderLoginFailure,
  ProviderLoginFlow,
  ProviderModel,
  ProviderSummary,
  ProviderTestFailure,
} from "../api/schema/providers.ts";

export type ProviderBrand = { id: string; name: string; providers: readonly string[] };

/** The brands the setup wizard offers, in the order it lists them. A provider keeps its PI identity. */
export const providerBrands: readonly ProviderBrand[] = [
  { id: "openai", name: "OpenAI", providers: ["openai-codex", "openai"] },
  { id: "anthropic", name: "Claude", providers: ["anthropic"] },
  { id: "opencode-go", name: "OpenCode Go", providers: ["opencode-go"] },
  { id: "mistral", name: "Mistral", providers: ["mistral"] },
];

export function providerBrand(id: string): ProviderBrand | undefined {
  return providerBrands.find((brand) => brand.providers.includes(id));
}

/** The name a connection card shows; the provider's own, except where HUI distinguishes the two OpenAI routes. */
export function connectionName(provider: ProviderSummary): string {
  if (provider.id === "openai-codex") return "OpenAI · ChatGPT account";
  if (provider.id === "openai") return "OpenAI · all GPT models";
  if (provider.id === "anthropic") return "Claude";
  return provider.name;
}

export type ConnectionMethod = {
  provider: ProviderSummary;
  method: "api_key" | "oauth";
  label: string;
  hint: string;
};

const API_KEY_HINT = "Enter a key saved securely by HUI.";

/** One label and one hint per provider and method: what signing in gets you, in the operator's words. */
const METHOD_COPY: Readonly<Record<string, { label: string; hint: string }>> = {
  "openai-codex/oauth": { label: "ChatGPT account", hint: "Codex models, Calls with GPT-Live, and usage limits." },
  "openai/oauth": { label: "ChatGPT account · all GPT models", hint: "Every GPT model OpenAI lists. No Calls or usage limits." },
  "openai/api_key": { label: "API key", hint: "Pay per use with an OpenAI API key." },
  "anthropic/oauth": { label: "Claude Pro / Max", hint: "Sign in with your Claude subscription." },
  "anthropic/api_key": { label: "API key", hint: "Pay per use with an Anthropic API key." },
};

/** The sign-in methods a brand can start now, in its provider order. A provider PI does not expose is left out. */
export function connectionMethods(brand: string, providers: readonly ProviderSummary[]): ConnectionMethod[] {
  const definition = providerBrands.find((entry) => entry.id === brand);
  const ids: readonly string[] = definition?.providers ?? providers.filter((entry) => entry.id === brand && entry.configured).map((entry) => entry.id);
  return ids.flatMap<ConnectionMethod>((id) => {
    const provider = providers.find((entry) => entry.id === id);
    if (!provider) return [];
    return provider.methods.map((method) => {
      const copy = METHOD_COPY[`${id}/${method.id}`];
      return {
        provider,
        method: method.id,
        label: copy?.label ?? (method.id === "api_key" ? "API key" : "Sign in"),
        hint: copy?.hint ?? (method.id === "api_key" ? API_KEY_HINT : `Sign in with your ${provider.name} subscription.`),
      };
    });
  });
}

/** What a brand's sign-in asks for, named for its subscription, so the hint follows the methods it actually has. */
const BRAND_SUBSCRIPTIONS: Readonly<Record<string, string>> = {
  openai: "ChatGPT account",
  anthropic: "Claude subscription",
  "opencode-go": "OpenCode Go subscription",
  mistral: "Mistral plan and its API credits",
};

/** A brand's one-line hint, derived from the methods its providers offer rather than written beside them. */
export function brandHint(brand: string, providers: readonly ProviderSummary[]): string {
  const methods = connectionMethods(brand, providers).map((choice) => choice.method);
  const subscription = BRAND_SUBSCRIPTIONS[brand] ?? "subscription";
  if (methods.includes("oauth") && methods.includes("api_key")) return `${subscription} or API key.`;
  if (methods.includes("oauth")) return `Sign in with your ${subscription}.`;
  if (methods.includes("api_key")) return `Use your ${subscription}.`;
  return "";
}

/** PI's own flows: the legacy Codex route offers a device code, the all-model route a browser callback and paste. */
const OAUTH_FLOWS: Readonly<Record<string, readonly ProviderLoginFlow[]>> = {
  "openai-codex": ["browser", "device_code"],
  openai: ["browser"],
  anthropic: ["browser", "copy_code"],
};

export function providerFlows(providerId: string): readonly ProviderLoginFlow[] {
  return OAUTH_FLOWS[providerId] ?? ["browser"];
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/** A callback can only land on this machine from a loopback page; anything else needs the provider's code flow. */
export function isLoopbackOrigin(origin: string): boolean {
  try {
    return LOOPBACK_HOSTS.has(new URL(origin).hostname.toLowerCase());
  } catch {
    return false;
  }
}

export function defaultFlow(providerId: string, origin: string): ProviderLoginFlow {
  if (isLoopbackOrigin(origin)) return "browser";
  return providerFlows(providerId).find((flow) => flow !== "browser") ?? "browser";
}

/** The other flow a sign-in can restart with, or none when the provider offers only one. */
export function alternateFlow(providerId: string, flow: ProviderLoginFlow): ProviderLoginFlow | undefined {
  return providerFlows(providerId).find((candidate) => candidate !== (flow === "browser" ? "browser" : flow));
}

export function flowSwitchLabel(flow: ProviderLoginFlow): string {
  return flow === "browser" ? "Use a code instead" : "Sign in in this browser instead";
}

export type ManualEntryCopy = { label: string; hint: string; placeholder: string };

const ADDRESS_PLACEHOLDER = "Paste the whole address, starting with http://localhost";

/** The paste field's own words: what to paste, and why the full callback address is required for one route. */
export function manualEntryCopy(providerId: string, flow: ProviderLoginFlow | undefined): ManualEntryCopy {
  if (flow === "copy_code") {
    return {
      label: "Code from Anthropic",
      hint: "Paste the code Anthropic shows after you sign in.",
      placeholder: "Paste the code Anthropic shows after you sign in",
    };
  }
  if (providerId === "openai") {
    return {
      label: "Callback address",
      hint: "The full callback address is required. Copy the address of the page that could not load.",
      placeholder: ADDRESS_PLACEHOLDER,
    };
  }
  return {
    label: "Code or callback address",
    hint: "Paste the code or the full callback address; either works.",
    placeholder: ADDRESS_PLACEHOLDER,
  };
}

/** The page a device code is entered on, for "Enter this code at …". */
export function signInHost(url: string | undefined): string {
  try {
    const parsed = new URL(url ?? "");
    return `${parsed.host}${parsed.pathname}`;
  } catch {
    return "the sign-in page";
  }
}

/** How long a device code still has, rounded up, from the expiry the gateway took from PI. A payload without one (an
 * older gateway, or a flow that reported none) falls back to PI's fifteen minutes counted from the sign-in's start. */
export function expiresInMinutes(login: Pick<ProviderLogin, "expiresAt">, startedAt: number, now = Date.now()): number {
  const deadline = login.expiresAt ?? startedAt + 15 * 60_000;
  return Math.max(0, Math.ceil((deadline - now) / 60_000));
}

export type FailureCopy = { title: string; sentence: string };

/** A stopped sign-in: the gateway's reason turned into a title and one plain sentence. */
export function loginFailure(reason: ProviderLoginFailure | undefined): FailureCopy {
  switch (reason) {
    case "cancelled": return { title: "Sign-in cancelled", sentence: "Sign-in stopped before it finished. Start again when you are ready." };
    case "expired": return { title: "Sign-in expired", sentence: "The sign-in waited too long for an answer. Start again to get a fresh link or code." };
    case "stale_link": return { title: "Sign-in link already used", sentence: "That sign-in link was already used. Start again to get a fresh one." };
    case "port_in_use": return { title: "Sign-in port in use", sentence: "The local sign-in port is already in use. Close other sign-ins or the Codex CLI, then try again." };
    case "network": return { title: "Connection problem", sentence: "HUI could not reach the provider. Check the connection and try again." };
    default: return { title: "Sign-in failed", sentence: "The provider stopped the sign-in. Try again, or choose another method." };
  }
}

export type TestFailureCopy = { title: string; guidance: string };

/** A failed model check: the gateway's category, plus the one thing worth trying next. */
export function testFailure(reason: ProviderTestFailure | undefined): TestFailureCopy {
  switch (reason) {
    case "auth": return { title: "Authentication failed", guidance: "Sign in again for this account, then check the model." };
    case "rate_limit": return { title: "Rate limited", guidance: "This account is out of quota right now. Wait a moment, then retry the test." };
    case "billing": return { title: "Billing problem", guidance: "Check the plan or billing details for this account." };
    case "timeout": return { title: "Timed out", guidance: "The provider did not answer in time. Retry the test or choose another model." };
    case "format": return { title: "Invalid response", guidance: "The model answered in a way HUI cannot read. Choose another model." };
    case "unavailable": return { title: "Unavailable", guidance: "The provider is not answering right now. Retry the test in a moment." };
    default: return { title: "Connection failed", guidance: "HUI could not finish the check. Retry the test or choose another model." };
  }
}

export type ModelStep = { options: readonly ProviderModel[]; selected: string; saved: string[] };

/** What leaving the model step writes. A new connection saves exactly the model it holds; a provider that already had
 * models keeps every one of them and gains this one, so a reconnect never narrows the selection. A provider with no
 * model writes nothing, never an empty selection. */
export function modelsToSave(saved: readonly string[], selected: string): string[] {
  if (!selected) return [];
  return [...new Set([...saved, selected])];
}

/** Step 4: the catalog to list, the model it preselects and what leaving it saves. A saved or chosen model wins, then
 * the first model; a saved model the catalog no longer lists cannot be written back, because the gateway accepts
 * catalog IDs only. */
export function modelsForStep(models: readonly ProviderModel[], saved: readonly string[], chosen?: string): ModelStep {
  const selected = (chosen && models.some((model) => model.id === chosen) ? chosen : "")
    || saved.find((id) => models.some((model) => model.id === id))
    || models[0]?.id
    || "";
  const kept = saved.filter((id) => models.some((model) => model.id === id));
  return { options: models, selected, saved: modelsToSave(kept, selected) };
}

/** The model rows a search leaves, matching every term against the display name or the model ID. */
export function filterModels(models: readonly ProviderModel[], query: string): readonly ProviderModel[] {
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  return terms.length ? models.filter((model) => terms.every((term) => `${model.id} ${model.name}`.toLowerCase().includes(term))) : models;
}

export type ModelRoles = { primary: string; utility: string };
export type ModelUseReport = ModelRoles & { assignedPrimary: boolean; assignedUtility: boolean };

/** The roles a checked model fills: new sessions use it where nothing is chosen yet, never over an existing choice. */
export function useModelRoles(current: ModelRoles, target: string): ModelUseReport {
  return {
    primary: current.primary || target,
    utility: current.utility || target,
    assignedPrimary: !current.primary,
    assignedUtility: !current.utility,
  };
}
