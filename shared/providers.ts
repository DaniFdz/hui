/** Browser-safe provider configuration and authentication progress. */
export type ProviderModel = { id: string; name: string; contextWindow?: number; maxTokens?: number };
export type ProviderSummary = {
  id: string; name: string; methods: { id: "api_key" | "oauth"; label: string }[];
  accounts?: { id: string; name: string; email?: string; authenticated: boolean; cooldownUntil?: number }[];
  configured: boolean; authenticated: boolean; selected: string[]; models: ProviderModel[];
};
export type ProviderLogin = {
  id: string; provider: string; phase: "pending" | "complete" | "failed" | "cancelled";
  accountId?: string;
  message?: string; url?: string; code?: string;
  prompt?: { id: string; type: "text" | "secret" | "select" | "manual_code"; message: string; options?: { id: string; label: string }[] };
};
export type ProviderSnapshot = { providers: ProviderSummary[]; login?: ProviderLogin };
export type ProviderQuota = {
  status: "available" | "unsupported" | "unavailable";
  message?: string; checkedAt: number;
  plan?: string; email?: string;
  access?: "available" | "limited";
  windows: { label: string; usedPercent: number; resetAt?: number; scope: "account" | "scoped" | "spend" }[];
};
